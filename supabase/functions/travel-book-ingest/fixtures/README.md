# Synthetic image fixtures

`red.heic`: a 40 × 20 solid red image created for this test suite from a generated PNG with macOS `sips -s format heic`. No user photograph or personal data. The encoded image is retained so CI needs no HEIC encoder.

`test-rgb.icc`: synthetic ICC v2 RGB matrix profile generated for tests (D50 whitepoint, RGB matrix and gamma 2.2 curves). It tests profile byte retention, not print fidelity or conformance of a commercial colour space. No third-party profile redistributed.
