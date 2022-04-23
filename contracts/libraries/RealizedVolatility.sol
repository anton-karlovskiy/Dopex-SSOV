// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

library RealizedVolatility {
    uint256 private constant FIXED_1 = 0x080000000000000000000000000000000;
    uint256 private constant FIXED_2 = 0x100000000000000000000000000000000;
    uint256 private constant SQRT_1 = 13043817825332782212;
    uint256 private constant LOG_10_2 = 3010299957;
    uint256 private constant BASE = 1e10;

    function floorLog2(uint256 _n) public pure returns (uint8) {
        uint8 res = 0;

        if (_n < 256) {
            // At most 8 iterations
            while (_n > 1) {
                _n >>= 1;
                res += 1;
            }
        } else {
            // Exactly 8 iterations
            for (uint8 s = 128; s > 0; s >>= 1) {
                if (_n >= (uint256(1) << s)) {
                    _n >>= s;
                    res |= s;
                }
            }
        }

        return res;
    }

    function generalLog(uint256 x) public pure returns (uint256) {
        uint256 res = 0;

        // If x >= 2, then we compute the integer part of log2(x), which is larger than 0.
        if (x >= FIXED_2) {
            uint8 count = floorLog2(x / FIXED_1);
            x >>= count; // now x < 2
            res = count * FIXED_1;
        }

        // If x > 1, then we compute the fraction part of log2(x), which is larger than 0.
        if (x > FIXED_1) {
            for (uint8 i = 127; i > 0; --i) {
                x = (x * x) / FIXED_1; // now 1 < x < 4
                if (x >= FIXED_2) {
                    x >>= 1; // now 1 < x < 2
                    res += uint256(1) << (i - 1);
                }
            }
        }

        return (res * LOG_10_2) / BASE;
    }

    function sqrt(uint256 x) public pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function calculateRv(uint256[] memory p) public pure returns (uint256 x) {
        for (uint8 i = 1; i <= (p.length - 1); i++) {
            x +=
                (
                    (generalLog(p[i] * FIXED_1) -
                        generalLog(p[i - 1] * FIXED_1))
                ) **
                    2;
            //denom += FIXED_1**2;
        }
        //return (sum, denom);
        x = sqrt(uint256(252) * sqrt(x / (p.length - 1)));
        return (uint256(1e18) * x) / SQRT_1;
    }
}
