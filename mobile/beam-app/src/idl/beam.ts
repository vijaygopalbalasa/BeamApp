/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/beam.json`.
 */
export type Beam = {
  "address": "6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi",
  "metadata": {
    "name": "beam",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Beam - Offline-first P2P payments with escrow on Solana"
  },
  "instructions": [
    {
      "name": "fundEscrow",
      "docs": [
        "Add funds to existing escrow"
      ],
      "discriminator": [
        155,
        18,
        218,
        141,
        182,
        213,
        69,
        201
      ],
      "accounts": [
        {
          "name": "escrowAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "escrowAccount"
          ]
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeEscrow",
      "docs": [
        "Initialize escrow account for offline payments"
      ],
      "discriminator": [
        243,
        160,
        77,
        153,
        11,
        92,
        48,
        209
      ],
      "accounts": [
        {
          "name": "escrowAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeNonceRegistry",
      "docs": [
        "Initialize nonce registry for payer"
      ],
      "discriminator": [
        34,
        149,
        53,
        133,
        236,
        53,
        88,
        85
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "nonceRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "reportFraudulentBundle",
      "docs": [
        "Report conflicting bundle evidence to initiate a fraud dispute"
      ],
      "discriminator": [
        42,
        97,
        16,
        195,
        32,
        174,
        213,
        89
      ],
      "accounts": [
        {
          "name": "nonceRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "payer"
        },
        {
          "name": "reporter",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "bundleId",
          "type": "string"
        },
        {
          "name": "conflictingHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "reason",
          "type": {
            "defined": {
              "name": "fraudReason"
            }
          }
        }
      ]
    },
    {
      "name": "settleOfflinePayment",
      "docs": [
        "Settle offline payment (called when either party goes online)"
      ],
      "discriminator": [
        48,
        91,
        112,
        242,
        39,
        5,
        142,
        80
      ],
      "accounts": [
        {
          "name": "escrowAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "owner",
          "relations": [
            "escrowAccount",
            "nonceRegistry"
          ]
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "merchant"
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "merchantTokenAccount",
          "writable": true
        },
        {
          "name": "nonceRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "payerNonce",
          "type": "u64"
        },
        {
          "name": "bundleId",
          "type": "string"
        },
        {
          "name": "evidence",
          "type": {
            "defined": {
              "name": "settlementEvidence"
            }
          }
        }
      ]
    },
    {
      "name": "withdrawEscrow",
      "docs": [
        "Withdraw unused escrow funds"
      ],
      "discriminator": [
        81,
        84,
        226,
        128,
        245,
        47,
        96,
        104
      ],
      "accounts": [
        {
          "name": "escrowAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "escrowAccount"
          ]
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "nonceRegistry",
      "discriminator": [
        115,
        114,
        189,
        172,
        239,
        92,
        79,
        240
      ]
    },
    {
      "name": "offlineEscrowAccount",
      "discriminator": [
        40,
        240,
        18,
        133,
        125,
        191,
        137,
        142
      ]
    }
  ],
  "events": [
    {
      "name": "bundleHistoryRecorded",
      "discriminator": [
        236,
        67,
        228,
        115,
        144,
        136,
        59,
        173
      ]
    },
    {
      "name": "escrowFunded",
      "discriminator": [
        228,
        243,
        166,
        74,
        22,
        167,
        157,
        244
      ]
    },
    {
      "name": "escrowInitialized",
      "discriminator": [
        222,
        186,
        157,
        47,
        145,
        142,
        176,
        248
      ]
    },
    {
      "name": "escrowWithdrawn",
      "discriminator": [
        43,
        206,
        174,
        47,
        105,
        219,
        216,
        239
      ]
    },
    {
      "name": "fraudEvidenceSubmitted",
      "discriminator": [
        227,
        24,
        222,
        208,
        122,
        37,
        231,
        252
      ]
    },
    {
      "name": "paymentSettled",
      "discriminator": [
        158,
        182,
        152,
        76,
        105,
        23,
        232,
        135
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAmount",
      "msg": "Invalid amount specified"
    },
    {
      "code": 6001,
      "name": "insufficientFunds",
      "msg": "Insufficient funds in escrow"
    },
    {
      "code": 6002,
      "name": "invalidNonce",
      "msg": "Invalid nonce (must be > last_nonce)"
    },
    {
      "code": 6003,
      "name": "invalidEscrowTokenAccount",
      "msg": "Escrow token account owner must be the escrow PDA"
    },
    {
      "code": 6004,
      "name": "invalidOwner",
      "msg": "Invalid owner"
    },
    {
      "code": 6005,
      "name": "missingAttestation",
      "msg": "Attestation required"
    },
    {
      "code": 6006,
      "name": "invalidAttestation",
      "msg": "Invalid attestation provided"
    },
    {
      "code": 6007,
      "name": "invalidBundleId",
      "msg": "Invalid bundle identifier"
    },
    {
      "code": 6008,
      "name": "duplicateBundle",
      "msg": "Duplicate bundle detected"
    },
    {
      "code": 6009,
      "name": "invalidBundleHash",
      "msg": "Invalid bundle hash"
    },
    {
      "code": 6010,
      "name": "bundleHistoryNotFound",
      "msg": "Bundle history not found"
    },
    {
      "code": 6011,
      "name": "fraudHashMatches",
      "msg": "Conflicting hash matches settled bundle"
    },
    {
      "code": 6012,
      "name": "fraudEvidenceExists",
      "msg": "Fraud evidence already exists"
    },
    {
      "code": 6013,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6014,
      "name": "underflow",
      "msg": "Arithmetic underflow"
    }
  ],
  "types": [
    {
      "name": "attestationProof",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "attestationRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "attestationNonce",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "attestationTimestamp",
            "type": "i64"
          },
          {
            "name": "verifierSignature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bundleHistoryRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "bundleHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "bundleRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bundleHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "escrowFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "newBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "escrowInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "initialBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "escrowWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "remainingBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fraudEvidenceSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "reporter",
            "type": "pubkey"
          },
          {
            "name": "bundleHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "conflictingHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reason",
            "type": {
              "defined": {
                "name": "fraudReason"
              }
            }
          },
          {
            "name": "reportedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "fraudReason",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "duplicateBundle"
          },
          {
            "name": "invalidAttestation"
          },
          {
            "name": "other"
          }
        ]
      }
    },
    {
      "name": "fraudRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bundleHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "conflictingHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reporter",
            "type": "pubkey"
          },
          {
            "name": "reportedAt",
            "type": "i64"
          },
          {
            "name": "reason",
            "type": {
              "defined": {
                "name": "fraudReason"
              }
            }
          }
        ]
      }
    },
    {
      "name": "nonceRegistry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "lastNonce",
            "type": "u64"
          },
          {
            "name": "recentBundleHashes",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "bundleHistory",
            "type": {
              "vec": {
                "defined": {
                  "name": "bundleRecord"
                }
              }
            }
          },
          {
            "name": "fraudRecords",
            "type": {
              "vec": {
                "defined": {
                  "name": "fraudRecord"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "offlineEscrowAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "escrowTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "escrowBalance",
            "type": "u64"
          },
          {
            "name": "lastNonce",
            "type": "u64"
          },
          {
            "name": "reputationScore",
            "type": "u16"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "paymentSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "bundleId",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "settlementEvidence",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payerProof",
            "type": {
              "option": {
                "defined": {
                  "name": "attestationProof"
                }
              }
            }
          },
          {
            "name": "merchantProof",
            "type": {
              "option": {
                "defined": {
                  "name": "attestationProof"
                }
              }
            }
          }
        ]
      }
    }
  ]
};
