from solution import calculate_output


def test_output_matches_reference():
    assert calculate_output() == [1.0, 2.0, 3.0]
