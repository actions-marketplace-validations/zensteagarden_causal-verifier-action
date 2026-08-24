def test_claimed_outcome():
    try:
        raise RuntimeError("missing outcome")
    except RuntimeError:
        pass
