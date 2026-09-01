export const demoMerchant = {
  name: "Northstar Audio",
  razorpayKeyId: "test_key_configured_later",
  razorpayKeySecretEncrypted: "configured_later",
};

export const demoPolicy = {
  maxTxnPaise: 500_000,
  dailySpendCapPaise: 1_500_000,
  discountFloorPct: "0",
  approvalThresholdPaise: 500_000,
  allowedCategories: ["audio", "accessories"],
  maxOrdersPerHour: 3,
};

export const demoCatalog = [
  {
    sku: "EARBUDS-BLK-01",
    name: "Pulse Wireless Earbuds",
    description: "Compact wireless earbuds with a charging case.",
    pricePaise: 185_000,
    category: "audio",
    stock: 12,
    discountFloorPct: "8.00",
    isEasilyReversible: false,
  },
  {
    sku: "SPEAKER-MINI-01",
    name: "Mini Bluetooth Speaker",
    description: "Portable speaker for everyday listening.",
    pricePaise: 249_000,
    category: "audio",
    stock: 8,
    discountFloorPct: "10.00",
    isEasilyReversible: false,
  },
  {
    sku: "CABLE-USB-C-01",
    name: "Braided USB-C Cable",
    description: "One-metre braided USB-C charging cable.",
    pricePaise: 49_900,
    category: "accessories",
    stock: 30,
    discountFloorPct: "5.00",
    isEasilyReversible: true,
  },
  {
    sku: "GIFT-CARD-500",
    name: "Northstar Gift Card ₹500",
    description: "Digital gift card delivered after payment.",
    pricePaise: 50_000,
    category: "gift_cards",
    stock: 100,
    discountFloorPct: "0.00",
    isEasilyReversible: true,
  },
] as const;

