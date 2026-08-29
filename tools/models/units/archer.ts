import type { ModelDef } from "../types";

const SKIN = "#c99a6e";
const HOOD = "#35543a";
const TUNIC = "#46704a";
const BELT = "#3a2a1c";
const LEATHER = "#6d4c2f";
const BOOT = "#2e2119";
const BRACER = "#5a3f28";
const BOW_WOOD = "#7d5230";
const STRING = "#ded6c2";
const QUIVER = "#5c3d24";
const FLETCH = "#cfc7b2";
const STEEL = "#b8bec7";

const NOCK_X = -0.233;
const TIP_Z = 0.482;

export const archerModel: ModelDef = {
  id: "archer",
  root: {
    name: "root",
    size: [0, 0, 0],
    pivot: [0, 0, 0.86],
    children: [
      {
        name: "pelvis",
        size: [0.23, 0.36, 0.16],
        offset: [0, 0, 0.06],
        color: BELT,
      },
      {
        name: "torso",
        size: [0.24, 0.42, 0.56],
        offset: [0, 0, 0.3],
        color: TUNIC,
        children: [
          {
            name: "head",
            size: [0.23, 0.23, 0.25],
            pivot: [0, 0, 0.58],
            offset: [0, 0, 0.12],
            color: SKIN,
            children: [
              {
                name: "hood",
                size: [0.3, 0.28, 0.1],
                pivot: [0, 0, 0.2],
                offset: [-0.02, 0, 0.02],
                color: HOOD,
              },
              {
                name: "hoodPeak",
                size: [0.16, 0.2, 0.12],
                pivot: [0, 0, 0.24],
                offset: [-0.1, 0, 0.02],
                color: HOOD,
              },
            ],
          },
          {
            name: "armLeft",
            size: [0.12, 0.12, 0.3],
            pivot: [0, 0.26, 0.5],
            offset: [0, 0, -0.15],
            rotation: [0, -1.42, 0.1],
            color: TUNIC,
            children: [
              {
                name: "foreLeft",
                size: [0.095, 0.095, 0.28],
                pivot: [0, 0, -0.3],
                offset: [0, 0, -0.14],
                rotation: [0, 0.12, 0],
                color: SKIN,
                children: [
                  {
                    name: "bracerLeft",
                    size: [0.115, 0.115, 0.13],
                    offset: [0, 0, -0.07],
                    color: BRACER,
                  },
                  {
                    name: "handLeft",
                    size: [0.105, 0.105, 0.08],
                    offset: [0, 0, -0.26],
                    color: SKIN,
                  },
                  {
                    name: "bowGrip",
                    size: [0, 0, 0],
                    pivot: [0, 0, -0.28],
                    rotation: [0, 1.3, 0],
                    children: [
                      {
                        name: "riser",
                        size: [0.05, 0.05, 0.24],
                        color: BOW_WOOD,
                      },
                      {
                        name: "limbUpper",
                        size: [0.045, 0.045, 0.26],
                        pivot: [0, 0, 0.12],
                        offset: [0, 0, 0.13],
                        rotation: [0, -0.4, 0],
                        color: BOW_WOOD,
                        children: [
                          {
                            name: "tipUpper",
                            size: [0.035, 0.035, 0.18],
                            pivot: [0, 0, 0.26],
                            offset: [0, 0, 0.09],
                            rotation: [0, -0.42, 0],
                            color: BOW_WOOD,
                          },
                        ],
                      },
                      {
                        name: "limbLower",
                        size: [0.045, 0.045, 0.26],
                        pivot: [0, 0, -0.12],
                        offset: [0, 0, -0.13],
                        rotation: [0, 0.4, 0],
                        color: BOW_WOOD,
                        children: [
                          {
                            name: "tipLower",
                            size: [0.035, 0.035, 0.18],
                            pivot: [0, 0, -0.26],
                            offset: [0, 0, -0.09],
                            rotation: [0, 0.42, 0],
                            color: BOW_WOOD,
                          },
                        ],
                      },
                      {
                        name: "stringUpper",
                        size: [0.014, 0.014, 0.482],
                        pivot: [NOCK_X, 0, TIP_Z],
                        offset: [0, 0, -0.241],
                        color: STRING,
                      },
                      {
                        name: "stringLower",
                        size: [0.014, 0.014, 0.482],
                        pivot: [NOCK_X, 0, -TIP_Z],
                        offset: [0, 0, 0.241],
                        color: STRING,
                      },
                      {
                        name: "arrow",
                        size: [0.6, 0.018, 0.018],
                        pivot: [NOCK_X, 0, 0],
                        offset: [0.3, 0, 0],
                        color: BOW_WOOD,
                        children: [
                          {
                            name: "arrowHead",
                            size: [0.07, 0.035, 0.035],
                            pivot: [0.6, 0, 0],
                            offset: [0.035, 0, 0],
                            color: STEEL,
                          },
                          {
                            name: "fletching",
                            size: [0.11, 0.012, 0.075],
                            pivot: [0.04, 0, 0],
                            offset: [0.055, 0, 0],
                            color: FLETCH,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            name: "armRight",
            size: [0.12, 0.12, 0.3],
            pivot: [0, -0.26, 0.5],
            offset: [0, 0, -0.15],
            rotation: [0.97, -1.23, 0],
            color: TUNIC,
            children: [
              {
                name: "foreRight",
                size: [0.095, 0.095, 0.28],
                pivot: [0, 0, -0.3],
                offset: [0, 0, -0.14],
                rotation: [0, -0.15, 0],
                color: SKIN,
                children: [
                  {
                    name: "bracerRight",
                    size: [0.115, 0.115, 0.13],
                    offset: [0, 0, -0.07],
                    color: BRACER,
                  },
                  {
                    name: "handRight",
                    size: [0.105, 0.105, 0.08],
                    offset: [0, 0, -0.26],
                    color: SKIN,
                  },
                ],
              },
            ],
          },
          {
            name: "quiver",
            size: [0.13, 0.13, 0.4],
            pivot: [-0.14, -0.12, 0.3],
            offset: [0, 0, 0.1],
            rotation: [0, -0.25, 0],
            color: QUIVER,
            children: [
              {
                name: "quiverArrows",
                size: [0.07, 0.1, 0.16],
                pivot: [0, 0, 0.3],
                offset: [0, 0, 0.08],
                color: FLETCH,
              },
            ],
          },
        ],
      },
      {
        name: "legLeft",
        size: [0.14, 0.16, 0.8],
        pivot: [0, 0.11, 0],
        offset: [0, 0, -0.4],
        rotation: [0.08, 0, 0],
        color: LEATHER,
        children: [
          {
            name: "bootLeft",
            size: [0.2, 0.16, 0.12],
            pivot: [0, 0, -0.8],
            offset: [0.02, 0, 0.06],
            color: BOOT,
          },
        ],
      },
      {
        name: "legRight",
        size: [0.14, 0.16, 0.8],
        pivot: [0, -0.11, 0],
        offset: [0, 0, -0.4],
        rotation: [-0.08, 0, 0],
        color: LEATHER,
        children: [
          {
            name: "bootRight",
            size: [0.2, 0.16, 0.12],
            pivot: [0, 0, -0.8],
            offset: [0.02, 0, 0.06],
            color: BOOT,
          },
        ],
      },
    ],
  },
  animations: [
    {
      name: "idle",
      frames: 8,
      loop: true,
      tracks: {
        root: [
          { t: 0, offset: [0, 0, 0] },
          { t: 0.5, offset: [0, 0, -0.018] },
        ],
        torso: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 0.5, rotation: [0, 0.035, 0] },
        ],
        head: [
          { t: 0, rotation: [0, 0, 0.05] },
          { t: 0.5, rotation: [0, -0.04, -0.03] },
        ],
        armLeft: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 0.5, rotation: [0, -0.05, 0.02] },
        ],
        armRight: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 0.5, rotation: [0, 0.06, 0] },
        ],
      },
    },
    {
      name: "draw",
      frames: 8,
      loop: false,
      tracks: {
        armLeft: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0, -0.1, -0.02] },
        ],
        foreLeft: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0, -0.09, 0] },
        ],
        armRight: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0.36, 1.12, 0] },
        ],
        foreRight: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0, -0.55, 0] },
        ],
        torso: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0, 0, -0.1] },
        ],
        stringUpper: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0, 0.726, 0] },
        ],
        stringLower: [
          { t: 0, rotation: [0, 0, 0] },
          { t: 1, rotation: [0, -0.726, 0] },
        ],
        arrow: [
          { t: 0, offset: [0, 0, 0] },
          { t: 1, offset: [-0.32, 0, 0] },
        ],
      },
    },
    {
      name: "loose",
      frames: 5,
      loop: false,
      tracks: {
        armLeft: [
          { t: 0, rotation: [0, -0.1, -0.02] },
          { t: 1, rotation: [0, -0.04, 0] },
        ],
        foreLeft: [
          { t: 0, rotation: [0, -0.09, 0] },
          { t: 1, rotation: [0, -0.02, 0] },
        ],
        armRight: [
          { t: 0, rotation: [0.36, 1.12, 0] },
          { t: 0.45, rotation: [0.46, 1.36, 0] },
          { t: 1, rotation: [0.52, 1.5, 0] },
        ],
        foreRight: [
          { t: 0, rotation: [0, -0.55, 0] },
          { t: 1, rotation: [0, -0.18, 0] },
        ],
        torso: [
          { t: 0, rotation: [0, 0, -0.1] },
          { t: 1, rotation: [0, 0, -0.02] },
        ],
        stringUpper: [
          { t: 0, rotation: [0, 0.726, 0] },
          { t: 0.35, rotation: [0, -0.1, 0] },
          { t: 1, rotation: [0, 0.02, 0] },
        ],
        stringLower: [
          { t: 0, rotation: [0, -0.726, 0] },
          { t: 0.35, rotation: [0, 0.1, 0] },
          { t: 1, rotation: [0, -0.02, 0] },
        ],
        arrow: [
          { t: 0, offset: [-0.32, 0, 0] },
          { t: 0.35, offset: [0.35, 0, 0] },
          { t: 1, offset: [1.9, 0, 0] },
        ],
      },
    },
  ],
};
