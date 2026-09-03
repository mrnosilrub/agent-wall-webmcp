export const CHALLENGE_FIXTURE = Object.freeze({
  mode: "fixture",
  chain: "base-sepolia",
  chainId: "84532",
  testnet: true,
  canonical: false,
  wall: Object.freeze({
    width: 1000,
    height: 1000,
    totalPixels: 1_000_000,
    occupiedPixels: 0,
  }),
  receipts: Object.freeze({
    "fixture-receipt-0001": Object.freeze({
      receiptId: "fixture-receipt-0001",
      status: "fixture",
      parcel: Object.freeze({ x: 0, y: 0, width: 3, height: 4 }),
      pixels: 12,
      priceUsdc: 12,
      scene: Object.freeze({
        width: 48,
        height: 64,
        texels: 3_072,
        rgbBytes: 9_216,
        programSha256:
          "80e2b334cdba4c959d887be682d103760047fe79f1e79a9195ccf5fad6a13dce",
        rgbSha256:
          "ed0623b48f99a7150ecb38c678a4fa22ee5f95a76aa43fa5d7c37c66f9d493ad",
      }),
    }),
  }),
} as const);

export const DEMO_SCENE_PROGRAM = Object.freeze({
  v: 1,
  background: Object.freeze([245, 242, 236] as const),
  ops: Object.freeze([
    Object.freeze({
      op: "CHECKER" as const,
      x: 0,
      y: 0,
      w: 48,
      h: 64,
      a: Object.freeze([245, 242, 236] as const),
      b: Object.freeze([124, 45, 45] as const),
      cell: 16,
    }),
  ]),
});
