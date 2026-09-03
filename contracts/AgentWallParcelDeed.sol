// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {WallOccupancy} from "./WallOccupancy.sol";

contract AgentWallParcelDeed is ERC721, EIP712, WallOccupancy, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint32 public constant TOTAL_PIXELS = 1_000_000;
    uint16 public constant GRID_SIZE = 1000;
    uint256 public constant PRICE_MICRO_USDC_PER_PIXEL = 1_000_000;
    uint16 public constant QUOTE_VERSION = 2;
    bytes32 public constant SCENE_PROTOCOL = 0x7363656e652d76312d7368617065730000000000000000000000000000000000;
    uint16 public constant SCENE_PROTOCOL_VERSION = 1;
    bytes32 public constant RENDERER_ID = 0x7afab57511b09097da38298f80b974e78e378ae5e2f2b1cf7a6a691ba6b889cc;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint16 quoteVersion,address paymentToken,address treasury,address payer,address recipient,address agentPrincipal,uint8 executionClass,uint16 x,uint16 y,uint16 width,uint16 height,uint32 pixels,uint256 amountMicroUsdc,bytes32 sceneProtocol,uint16 sceneProtocolVersion,bytes32 rendererId,bytes32 programHash,bytes32 rgbHash,bytes32 genesisLinkHash,uint64 deadline,bytes32 nonce)"
    );

    struct Quote {
        uint16 quoteVersion;
        address paymentToken;
        address treasury;
        address payer;
        address recipient;
        address agentPrincipal;
        uint8 executionClass;
        uint16 x;
        uint16 y;
        uint16 width;
        uint16 height;
        uint32 pixels;
        uint256 amountMicroUsdc;
        bytes32 sceneProtocol;
        uint16 sceneProtocolVersion;
        bytes32 rendererId;
        bytes32 programHash;
        bytes32 rgbHash;
        bytes32 genesisLinkHash;
        uint64 deadline;
        bytes32 nonce;
    }

    struct Parcel {
        uint16 x;
        uint16 y;
        uint16 width;
        uint16 height;
        uint32 pixels;
        uint32 sequence;
        uint64 mintedAt;
        uint64 amountMicroUsdc;
    }

    struct GenesisRecord {
        uint16 quoteVersion;
        uint32 sequence;
        uint16 x;
        uint16 y;
        uint16 width;
        uint16 height;
        uint32 pixels;
        uint64 amountMicroUsdc;
        address paymentToken;
        address treasury;
        address agentPrincipal;
        uint8 executionClass;
        bytes32 sceneProtocol;
        uint16 sceneProtocolVersion;
        bytes32 rendererId;
        bytes32 programHash;
        bytes32 rgbHash;
        bytes32 genesisLinkHash;
        bytes32 nonce;
        uint32 soldPixelsAfter;
    }

    IERC20 public immutable paymentToken;
    address public immutable treasury;
    address public immutable quoteSigner;

    uint32 public soldPixels;
    uint32 public sequence;

    mapping(bytes32 nonce => bool used) public usedNonces;
    mapping(uint256 tokenId => Parcel parcel) private _parcels;
    mapping(uint256 tokenId => bytes32 commitment) private _genesisCommitments;
    string private _tokenBaseURI;

    event ParcelClaimed(
        uint256 indexed tokenId, address indexed payer, address indexed recipient, GenesisRecord record
    );

    error InvalidAmount();
    error InvalidExecutionClass();
    error InvalidPaymentToken();
    error InvalidPayer();
    error InvalidQuoteSigner();
    error InvalidQuoteVersion();
    error InvalidRect();
    error InvalidRenderer();
    error InvalidSceneProtocol();
    error InvalidSceneProtocolVersion();
    error InvalidTreasury();
    error QuoteExpired();
    error QuoteReplay();
    error ZeroAddress();

    constructor(address paymentToken_, address treasury_, address quoteSigner_, string memory baseURI_)
        ERC721("Agent Wall Parcel Deed", "AWPD")
        EIP712("Agent Wall Parcel Deed", "2")
    {
        if (paymentToken_ == address(0) || treasury_ == address(0) || quoteSigner_ == address(0)) {
            revert ZeroAddress();
        }
        paymentToken = IERC20(paymentToken_);
        treasury = treasury_;
        quoteSigner = quoteSigner_;
        _tokenBaseURI = baseURI_;
    }

    function hashQuote(Quote memory quote) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    quote.quoteVersion,
                    quote.paymentToken,
                    quote.treasury,
                    quote.payer,
                    quote.recipient,
                    quote.agentPrincipal,
                    quote.executionClass,
                    quote.x,
                    quote.y,
                    quote.width,
                    quote.height,
                    quote.pixels,
                    quote.amountMicroUsdc,
                    quote.sceneProtocol,
                    quote.sceneProtocolVersion,
                    quote.rendererId,
                    quote.programHash,
                    quote.rgbHash,
                    quote.genesisLinkHash,
                    quote.deadline,
                    quote.nonce
                )
            )
        );
    }

    function tokenIdFor(uint16 x, uint16 y, uint16 width, uint16 height) public pure returns (uint256) {
        return (uint256(x) << 48) | (uint256(y) << 32) | (uint256(width) << 16) | uint256(height);
    }

    function claim(Quote calldata quote, bytes calldata signature) external nonReentrant {
        if (!SignatureChecker.isValidSignatureNow(quoteSigner, hashQuote(quote), signature)) {
            revert InvalidQuoteSigner();
        }
        if (quote.quoteVersion != QUOTE_VERSION) revert InvalidQuoteVersion();
        if (quote.paymentToken != address(paymentToken)) revert InvalidPaymentToken();
        if (quote.treasury != treasury) revert InvalidTreasury();
        if (msg.sender != quote.payer) revert InvalidPayer();
        if (quote.recipient == address(0)) revert ZeroAddress();
        if (quote.sceneProtocol != SCENE_PROTOCOL) revert InvalidSceneProtocol();
        if (quote.sceneProtocolVersion != SCENE_PROTOCOL_VERSION) revert InvalidSceneProtocolVersion();
        if (quote.rendererId != RENDERER_ID) revert InvalidRenderer();
        if (quote.executionClass > 3) revert InvalidExecutionClass();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > quote.deadline) revert QuoteExpired();
        if (usedNonces[quote.nonce]) revert QuoteReplay();
        if (quote.width == 0 || quote.height == 0) revert InvalidRect();
        if (quote.width > GRID_SIZE || quote.height > GRID_SIZE) revert InvalidRect();
        if (quote.x > GRID_SIZE - quote.width || quote.y > GRID_SIZE - quote.height) revert InvalidRect();
        uint32 pixels = uint32(quote.width) * uint32(quote.height);
        if (quote.pixels != pixels) revert InvalidRect();
        if (quote.amountMicroUsdc != uint256(pixels) * PRICE_MICRO_USDC_PER_PIXEL) {
            revert InvalidAmount();
        }

        _reserve(quote.x, quote.y, quote.width, quote.height);

        uint256 tokenId = tokenIdFor(quote.x, quote.y, quote.width, quote.height);
        uint32 claimSequence = sequence + 1;
        uint32 soldPixelsAfter = soldPixels + pixels;
        bytes32 commitment = keccak256(
            abi.encode(
                quote.sceneProtocol,
                quote.sceneProtocolVersion,
                quote.rendererId,
                quote.programHash,
                quote.rgbHash,
                quote.genesisLinkHash
            )
        );

        usedNonces[quote.nonce] = true;
        sequence = claimSequence;
        soldPixels = soldPixelsAfter;
        _parcels[tokenId] = Parcel({
            x: quote.x,
            y: quote.y,
            width: quote.width,
            height: quote.height,
            pixels: quote.pixels,
            sequence: claimSequence,
            mintedAt: uint64(block.timestamp),
            amountMicroUsdc: uint64(quote.amountMicroUsdc)
        });
        _genesisCommitments[tokenId] = commitment;

        paymentToken.safeTransferFrom(quote.payer, treasury, quote.amountMicroUsdc);
        _safeMint(quote.recipient, tokenId);

        emit ParcelClaimed(
            tokenId,
            quote.payer,
            quote.recipient,
            GenesisRecord({
                quoteVersion: quote.quoteVersion,
                sequence: claimSequence,
                x: quote.x,
                y: quote.y,
                width: quote.width,
                height: quote.height,
                pixels: quote.pixels,
                amountMicroUsdc: uint64(quote.amountMicroUsdc),
                paymentToken: quote.paymentToken,
                treasury: quote.treasury,
                agentPrincipal: quote.agentPrincipal,
                executionClass: quote.executionClass,
                sceneProtocol: quote.sceneProtocol,
                sceneProtocolVersion: quote.sceneProtocolVersion,
                rendererId: quote.rendererId,
                programHash: quote.programHash,
                rgbHash: quote.rgbHash,
                genesisLinkHash: quote.genesisLinkHash,
                nonce: quote.nonce,
                soldPixelsAfter: soldPixelsAfter
            })
        );
    }

    function parcelOf(uint256 tokenId) external view returns (Parcel memory) {
        _requireOwned(tokenId);
        return _parcels[tokenId];
    }

    function genesisCommitmentOf(uint256 tokenId) external view returns (bytes32) {
        _requireOwned(tokenId);
        return _genesisCommitments[tokenId];
    }

    function isPixelSold(uint16 x, uint16 y) external view returns (bool) {
        if (x >= GRID_SIZE || y >= GRID_SIZE) revert InvalidRect();
        return _isReserved(x, y);
    }

    function _baseURI() internal view override returns (string memory) {
        return _tokenBaseURI;
    }
}
