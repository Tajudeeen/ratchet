// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal IERC20 surface for tUSD8 (0x456569838f1d43009A91ebA4263147Afd7233483, 6 decimals).
interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Ratchet — scoped, expiring, revocable tUSD8 agent-payment sessions sharing one budget.
/// @notice All authorization is enforced on-chain; an off-chain verifier is only a convenience caller.
/// @dev EVM Shanghai; no OZ/mcopy dependency. Checks-effects-interactions + nonReentrant.
contract Ratchet {
    IERC20Min public immutable token;
    address public immutable owner;

    struct Session {
        uint256 perCallCap;
        uint256 totalCap;
        uint256 spent;
        uint256 validAfter;
        uint256 validBefore;
        bool revoked;
        address agent; // bound signer; cannot be replaced by a session holder
        mapping(address => bool) allowedPayees; // empty map = unrestricted (owner-funded test pot)
    }

    struct Payment {
        bytes32 sessionId;
        address agent;
        address payee;
        uint256 amount;
        bytes32 paymentId; // single-use idempotency key
        uint256 deadline;
    }

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PAYMENT_TYPEHASH =
        keccak256("Payment(bytes32 sessionId,address agent,address payee,uint256 amount,bytes32 paymentId,uint256 deadline)");

    bytes32 private immutable domainSeparator;
    uint256 public remainingBudget;

    mapping(bytes32 => Session) public sessions;
    mapping(bytes32 => bool) public usedPaymentIds;

    event Funded(address indexed from, uint256 amount);
    event SessionGranted(bytes32 indexed sessionId, address indexed agent, uint256 perCallCap, uint256 totalCap, uint256 validAfter, uint256 validBefore);
    event SessionRevoked(bytes32 indexed sessionId);
    event PayeeAllowed(bytes32 indexed sessionId, address indexed payee, bool allowed);
    event PaymentSettled(bytes32 indexed sessionId, bytes32 indexed paymentId, address indexed payee, uint256 amount);

    error SESSION_REVOKED();
    error SESSION_EXPIRED();
    error SESSION_NOT_ACTIVE();
    error CAP_EXCEEDED();
    error BUDGET_EXHAUSTED();
    error PAYMENT_ALREADY_SETTLED();
    error RECIPIENT_NOT_ALLOWED();
    error BAD_SIGNATURE();
    error NOT_OWNER();
    error ZERO_ADDRESS();
    error BAD_AMOUNT();
    error TRANSFER_FAILED();

    uint256 private lockStatus = 1;

    modifier nonReentrant() {
        require(lockStatus == 1, "REENTRANCY");
        lockStatus = 2;
        _;
        lockStatus = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NOT_OWNER();
        _;
    }

    constructor(address token_) {
        if (token_ == address(0)) revert ZERO_ADDRESS();
        token = IERC20Min(token_);
        owner = msg.sender;
        domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("Ratchet"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Owner pulls tUSD8 into the shared pot. Requires prior ERC-20 approval to this contract.
    function fund(uint256 amount) external onlyOwner {
        if (amount == 0) revert BAD_AMOUNT();
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TRANSFER_FAILED();
        remainingBudget += amount;
        emit Funded(msg.sender, amount);
    }

    /// @notice Owner grants a scoped session to an agent key.
    function grantSession(
        bytes32 sessionId,
        address agent,
        uint256 perCallCap,
        uint256 totalCap,
        uint256 validAfter,
        uint256 validBefore
    ) external onlyOwner {
        if (agent == address(0)) revert ZERO_ADDRESS();
        if (perCallCap == 0 || totalCap == 0 || perCallCap > totalCap) revert BAD_AMOUNT();
        if (validBefore <= block.timestamp) revert SESSION_EXPIRED();
        Session storage s = sessions[sessionId];
        s.perCallCap = perCallCap;
        s.totalCap = totalCap;
        s.spent = 0;
        s.validAfter = validAfter;
        s.validBefore = validBefore;
        s.revoked = false;
        s.agent = agent;
        emit SessionGranted(sessionId, agent, perCallCap, totalCap, validAfter, validBefore);
    }

    /// @notice Instant kill switch: all future payments in this session fail closed.
    function revoke(bytes32 sessionId) external onlyOwner {
        sessions[sessionId].revoked = true;
        emit SessionRevoked(sessionId);
    }

    /// @notice Allowlist guard. Once any payee is added, only allowlisted payees can receive.
    function setPayeeAllowed(bytes32 sessionId, address payee, bool allowed) external onlyOwner {
        if (payee == address(0)) revert ZERO_ADDRESS();
        sessions[sessionId].allowedPayees[payee] = allowed;
        if (allowed) restricted[sessionId] = true;
        emit PayeeAllowed(sessionId, payee, allowed);
    }

    function payeeRestricted(bytes32 sessionId) external view returns (bool) {
        // public getter of the mapping cannot tell "restricted" from empty; expose via explicit flag
        return restricted[sessionId];
    }

    mapping(bytes32 => bool) private restricted;

    function _recoverSigner(Payment calldata p, bytes calldata sig) internal view returns (address) {
        bytes32 structHash = keccak256(abi.encode(PAYMENT_TYPEHASH, p.sessionId, p.agent, p.payee, p.amount, p.paymentId, p.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        // ethers v6 signTypedData: r[0:32] || s[32:64] || v[64]
        return ecrecover(digest, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
    }

    /// @notice Settle a signed agent payment. Checks all caps atomically against the shared pot.
    function spend(Payment calldata p, bytes calldata sig) external nonReentrant {
        Session storage s = sessions[p.sessionId];

        // Fail closed, in this order.
        if (s.revoked) revert SESSION_REVOKED();
        if (s.agent == address(0) || p.agent != s.agent) revert BAD_SIGNATURE();
        if (block.timestamp < s.validAfter || block.timestamp > s.validBefore || block.timestamp > p.deadline) revert SESSION_EXPIRED();
        if (usedPaymentIds[p.paymentId]) revert PAYMENT_ALREADY_SETTLED();
        if (p.amount == 0 || p.amount > s.perCallCap) revert CAP_EXCEEDED();
        if (s.spent + p.amount > s.totalCap) revert CAP_EXCEEDED();
        if (p.amount > remainingBudget) revert BUDGET_EXHAUSTED();
        if (_recoverSigner(p, sig) != p.agent) revert BAD_SIGNATURE();
        if (restricted[p.sessionId] && !s.allowedPayees[p.payee]) revert RECIPIENT_NOT_ALLOWED();

        // Effects
        usedPaymentIds[p.paymentId] = true;
        s.spent += p.amount;
        remainingBudget -= p.amount; // ratchet only turns one way

        // Interaction
        bool ok = token.transfer(p.payee, p.amount);
        if (!ok) revert TRANSFER_FAILED();

        emit PaymentSettled(p.sessionId, p.paymentId, p.payee, p.amount);
    }

    function isSessionActive(bytes32 sessionId) external view returns (bool) {
        Session storage s = sessions[sessionId];
        return !s.revoked && block.timestamp >= s.validAfter && block.timestamp <= s.validBefore;
    }
}
