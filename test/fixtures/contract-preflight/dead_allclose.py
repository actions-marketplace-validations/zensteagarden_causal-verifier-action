import numpy as np

from solution import calculate_output


def test_output_matches_reference():
    np.allclose(calculate_output(), [1.0, 2.0, 3.0])
