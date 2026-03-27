// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal ERC-4337 interface definitions needed by the account
interface IEntryPoint {
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }
}

interface IAccount {
    function validateUserOp(
        IEntryPoint.PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
    function execute(address target, uint256 value, bytes calldata data) external;
}

/// @title SmartAccount with owner and session-key authentication (ERC-4337)
contract SmartAccount is IAccount {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    address public owner;
    IEntryPoint public immutable entryPoint;

    struct Session {
        uint256 expiry;
        bytes4[] selectors;
    }

    mapping(address => Session) private _sessions;

    event SessionKeyAdded(address indexed key, uint256 expiry);
    event SessionKeyRevoked(address indexed key);

    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "SmartAccount: caller is not entryPoint");
        _;
    }

    constructor(address _owner, address _entryPoint) {
        owner = _owner;
        entryPoint = IEntryPoint(_entryPoint);
    }

    /// @notice add or update a session key
    function addSessionKey(address key, uint256 expiry, bytes4[] calldata selectors) external {
        require(msg.sender == owner, "SmartAccount: only owner");
        require(expiry > block.timestamp, "SmartAccount: expiry must be in future");
        _sessions[key] = Session({expiry: expiry, selectors: selectors});
        emit SessionKeyAdded(key, expiry);
    }

    function revokeSessionKey(address key) external {
        require(msg.sender == owner, "SmartAccount: only owner");
        delete _sessions[key];
        emit SessionKeyRevoked(key);
    }

    function isValidSessionKey(address key, bytes4 selector) public view returns (bool) {
        Session storage s = _sessions[key];
        if (s.expiry < block.timestamp) {
            return false;
        }
        if (s.selectors.length == 0) {
            // if no selectors specified, allow everything until expiry
            return true;
        }
        for (uint256 i = 0; i < s.selectors.length; i++) {
            if (s.selectors[i] == selector) return true;
        }
        return false;
    }

    function getSessionKey(address key) external view returns (uint256 expiry, bytes4[] memory selectors, bool active) {
        Session storage session = _sessions[key];
        return (session.expiry, session.selectors, session.expiry >= block.timestamp);
    }

    /// @inheritdoc IAccount
    function validateUserOp(
        IEntryPoint.PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override returns (uint256 validationData) {
        require(msg.sender == address(entryPoint), "SmartAccount: caller is not entryPoint");

        // parse signature: first byte indicates type (0 = owner, 1 = session)
        bytes memory sig = userOp.signature;
        require(sig.length >= 1, "SmartAccount: empty signature");
        uint8 kind = uint8(sig[0]);

        if (kind == 0) {
            // owner signature: standard eth signed message of userOpHash
            bytes memory ownerSig = slice(sig, 1, sig.length - 1);
            if (!verifyOwnerSignature(userOpHash, ownerSig)) {
                return SIG_VALIDATION_FAILED;
            }
        } else if (kind == 1) {
            // session key; signature encodes key address + ECDSA sig
            // format: 1 || key(20 bytes) || ecdsaSig
            if (sig.length < 1 + 20 + 65) {
                return SIG_VALIDATION_FAILED;
            }
            address key = address(bytes20(slice(sig, 1, 20)));
            bytes memory ecdsaSig = slice(sig, 21, sig.length - 21);
            (bool hasSelector, bytes4 selector) = getRequestedSelector(userOp.callData);
            if (!hasSelector || !isValidSessionKey(key, selector)) {
                return SIG_VALIDATION_FAILED;
            }
            bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
            if (recoverSigner(digest, ecdsaSig) != key) {
                return SIG_VALIDATION_FAILED;
            }
        } else {
            return SIG_VALIDATION_FAILED;
        }
        if (missingAccountFunds > 0) {
            (bool success, ) = payable(msg.sender).call{value: missingAccountFunds}("");
            require(success, "SmartAccount: prefund failed");
        }
        // note: validationData could include time range but we return 0
        return 0;
    }

    function getRequestedSelector(bytes calldata callData) internal pure returns (bool, bytes4) {
        if (callData.length < 4 || bytes4(callData[:4]) != this.execute.selector) {
            return (false, bytes4(0));
        }
        (, , bytes memory innerData) = abi.decode(callData[4:], (address, uint256, bytes));
        if (innerData.length < 4) {
            return (false, bytes4(0));
        }
        return (true, bytes4(innerData));
    }

    function verifyOwnerSignature(bytes32 hash, bytes memory signature) internal view returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        return recoverSigner(digest, signature) == owner;
    }

    function recoverSigner(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "SmartAccount: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "SmartAccount: invalid v value");
        return ecrecover(hash, v, r, s);
    }

    /// simple slice utility
    function slice(
        bytes memory data,
        uint256 start,
        uint256 len
    ) internal pure returns (bytes memory) {
        bytes memory b = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            b[i] = data[start + i];
        }
        return b;
    }

    /// @inheritdoc IAccount
    function execute(address target, uint256 value, bytes calldata data) external override onlyEntryPoint {
        (bool success, ) = target.call{value: value}(data);
        require(success, "SmartAccount: call failed");
    }

    // allow contract to receive funds
    receive() external payable {}
}
