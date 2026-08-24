# Contract Assurance Proof

This frozen synthetic control reproduces the mechanism documented in Smithsonian/layup PR #467 without claiming that Noticer discovered the original defect.

The required discrimination is:

| Control | Ordinary pytest | Noticer preflight |
|---|---|---|
| Wrong source + discarded comparison | passes | blocks |
| Wrong source + binding assertion | fails | passes contract preflight, then fails execution |
| Correct source + same binding assertion | passes | passes |

Run the public workflow `.github/workflows/contract-assurance-proof.yml`. The proof is valid only when all four workflow steps establish the expected results.
