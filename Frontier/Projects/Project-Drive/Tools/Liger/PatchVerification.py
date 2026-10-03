#!/usr/bin/env python3
"""Focused numerical checks for conservative displacement bounds and chart rotations."""
import unittest
import numpy as np
from scipy.interpolate import BSpline
from PatchSequence import BernsteinBound, Patch, Join


class PatchVerification(unittest.TestCase):
    def test_interior_oscillation_is_bounded(self):
        Difference = np.zeros((4, 4, 3))
        Difference[1, 1, 0] = 1.
        Bound = BernsteinBound(Difference, np.eye(4), np.eye(4), .2)
        self.assertGreaterEqual(Bound, (4/9)**2)
        self.assertLessEqual(Bound, .2)
        self.assertTrue(np.isinf(BernsteinBound(Difference, np.eye(4), np.eye(4), .1)))

    def test_constant_displacement(self):
        Difference = np.ones((4, 4, 3))*.02
        self.assertAlmostEqual(BernsteinBound(Difference, np.eye(4), np.eye(4), .1), np.sqrt(3)*.02)

    def test_rotation_and_join_preserve_parameter_positions(self):
        Knots = np.r_[np.zeros(4), np.ones(4)]
        Points = np.zeros((4, 4, 3))
        Points[:, :, 0] = np.linspace(0, 1, 4)[:, None]
        Points[:, :, 1] = np.linspace(0, 1, 4)[None, :]
        A = Patch(Points, Knots, Knots, np.array([[0, 1], [2, 3]]), {0: np.eye(3)})
        B = Patch(Points+[1., 0., 0.], Knots, Knots, np.array([[2, 3], [4, 5]]), {1: np.eye(3)})
        for P in [A.Rotate(), A.Rotate().Rotate(), Join(A, B)]:
            for Identity, Transform in P.Charts.items():
                U, V, _ = Transform@np.array([.2, .7, 1.])
                Bu = BSpline(P.KnotsU, np.eye(P.Poles.shape[0]), 3)(U)
                Bv = BSpline(P.KnotsV, np.eye(P.Poles.shape[1]), 3)(V)
                Position = np.einsum('i,ijc,j->c', Bu, P.Poles, Bv)
                np.testing.assert_allclose(Position, [Identity+.2, .7, 0.], atol=1e-14)


if __name__ == '__main__':
    unittest.main()
