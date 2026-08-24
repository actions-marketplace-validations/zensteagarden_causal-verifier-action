#!/usr/bin/env python3
"""Fail-closed static preflight for Python outcome contracts.

The preflight reports only finding codes and locations. It never emits source.
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
import sys
from typing import Any


BOOLEAN_CALL_SUFFIXES = {
    "all",
    "allclose",
    "any",
    "array_equal",
    "array_equiv",
    "endswith",
    "exists",
    "fullmatch",
    "is_dir",
    "is_file",
    "isclose",
    "ismatch",
    "match",
    "search",
    "startswith",
}


def dotted_name(node: ast.AST) -> str:
    parts: list[str] = []
    current: ast.AST | None = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        parts.append(current.id)
    return ".".join(reversed(parts))


def is_test_function(node: ast.AST) -> bool:
    return isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test")


def constant_truth(node: ast.AST) -> bool | None:
    if isinstance(node, ast.Constant):
        try:
            return bool(node.value)
        except Exception:
            return None
    if isinstance(node, (ast.List, ast.Tuple, ast.Set, ast.Dict)):
        return bool(node.elts if hasattr(node, "elts") else node.keys)
    return None


def finding(code: str, node: ast.AST, detail: str) -> dict[str, Any]:
    return {
        "code": code,
        "line": int(getattr(node, "lineno", 0) or 0),
        "column": int(getattr(node, "col_offset", 0) or 0) + 1,
        "detail": detail,
    }


def analyze_test(test_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for node in ast.walk(test_node):
        if isinstance(node, ast.Expr):
            value = node.value
            if isinstance(value, (ast.Compare, ast.BoolOp)):
                findings.append(
                    finding(
                        "DISCARDED_COMPARISON",
                        node,
                        "comparison result is discarded and cannot fail the test",
                    )
                )
                continue
            if isinstance(value, ast.Call):
                name = dotted_name(value.func)
                suffix = name.rsplit(".", 1)[-1].lower()
                if suffix in BOOLEAN_CALL_SUFFIXES:
                    findings.append(
                        finding(
                            "DISCARDED_BOOLEAN_CALL",
                            node,
                            f"{suffix} result is discarded and cannot fail the test",
                        )
                    )

        if isinstance(node, ast.Assert):
            truth = constant_truth(node.test)
            if truth is True:
                findings.append(
                    finding(
                        "CONSTANT_TRUE_ASSERTION",
                        node,
                        "assertion is constant true and cannot reject an incorrect outcome",
                    )
                )

        if isinstance(node, ast.ExceptHandler):
            meaningful = [
                child
                for child in node.body
                if not (
                    isinstance(child, ast.Pass)
                    or (
                        isinstance(child, ast.Expr)
                        and isinstance(child.value, ast.Constant)
                        and isinstance(child.value.value, str)
                    )
                )
            ]
            if not meaningful:
                findings.append(
                    finding(
                        "SWALLOWED_EXCEPTION",
                        node,
                        "exception is swallowed, so a failed operation can appear successful",
                    )
                )

    return findings


def analyze(path: Path) -> dict[str, Any]:
    try:
        source = path.read_text(encoding="utf-8")
    except Exception as error:
        return {
            "status": "HARNESS_ERROR",
            "test_count": 0,
            "finding_count": 0,
            "findings": [],
            "error": f"cannot read contract: {type(error).__name__}",
        }

    try:
        tree = ast.parse(source, filename=path.name)
    except SyntaxError as error:
        return {
            "status": "HARNESS_ERROR",
            "test_count": 0,
            "finding_count": 1,
            "findings": [
                {
                    "code": "CONTRACT_SYNTAX_ERROR",
                    "line": int(error.lineno or 0),
                    "column": int(error.offset or 0),
                    "detail": "contract is not valid Python",
                }
            ],
            "error": "contract syntax error",
        }

    tests = [node for node in ast.walk(tree) if is_test_function(node)]
    findings: list[dict[str, Any]] = []
    for test_node in tests:
        findings.extend(analyze_test(test_node))

    if not tests:
        findings.append(
            {
                "code": "NO_TEST_FUNCTIONS",
                "line": 0,
                "column": 0,
                "detail": "no test functions were found in the selected contract",
            }
        )

    findings.sort(key=lambda item: (item["line"], item["column"], item["code"]))
    return {
        "status": "FAIL" if findings else "PASS",
        "test_count": len(tests),
        "finding_count": len(findings),
        "findings": findings,
        "error": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether a pytest contract contains high-confidence false-green patterns.")
    parser.add_argument("--test", required=True, type=Path)
    args = parser.parse_args()
    result = analyze(args.test)
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    if result["status"] == "PASS":
        return 0
    if result["status"] == "FAIL":
        return 3
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
