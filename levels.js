/* 本文件由 关卡批量转换器 自动生成，请勿手改。
   数据来源：编辑器导出的 lvN.json，已按关卡序号排列。
   重新生成：双击 convert-levels.cmd */
window.LEVELS_DATA = {
  "version": 12.0,
  "generator": "Die to Jump Level Bundler",
  "feel": {
    "maxWalkSpeed": 1.85,
    "groundAccel": 0.3,
    "airAccel": 0.4,
    "stopFriction": 0.79,
    "jumpMinHeight": 12,
    "jumpMaxHeight": 24,
    "jumpMaxHoldTime": 0.4,
    "gravity": 0.76,
    "maxFallSpeed": 4,
    "coyoteTime": 0.5,
    "jumpBufferTime": 0.35,
    "edgeSnapDist": 1
  },
  "levels": [
    {
      "id": "lv1",
      "name": "云间回响",
      "chambers": [
        {
          "id": "c1",
          "x": 0,
          "y": 0,
          "w": 480,
          "h": 120
        }
      ],
      "elements": [
        {
          "type": "platform",
          "x": 0,
          "y": 0,
          "w": 480,
          "h": 8
        },
        {
          "type": "platform",
          "x": 0,
          "y": 96,
          "w": 216,
          "h": 24
        },
        {
          "type": "platform",
          "x": 232,
          "y": 96,
          "w": 128,
          "h": 24
        },
        {
          "type": "platform",
          "x": 360,
          "y": 112,
          "w": 12,
          "h": 8
        },
        {
          "type": "platform",
          "x": 372,
          "y": 96,
          "w": 108,
          "h": 24
        },
        {
          "type": "spike",
          "x": 216,
          "y": 112,
          "w": 16,
          "h": 8
        },
        {
          "type": "spawn",
          "x": 24,
          "y": 96,
          "w": 8,
          "h": 8
        },
        {
          "type": "label",
          "x": 44,
          "y": 88,
          "w": 8,
          "h": 8,
          "text": "跳跃",
          "fontSize": 10,
          "color": "#ffffff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 35,
          "textOffsetY": -36,
          "pixelSize": 0.5
        },
        {
          "type": "flagPickup",
          "x": 88,
          "y": 88,
          "w": 8,
          "h": 8
        },
        {
          "type": "label",
          "x": 88,
          "y": 88,
          "w": 8,
          "h": 8,
          "text": "插旗 / 拔旗",
          "fontSize": 10,
          "color": "#ffdd44",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -36,
          "pixelSize": 0.5
        },
        {
          "type": "label",
          "x": 136,
          "y": 88,
          "w": 8,
          "h": 8,
          "text": "慢放幽灵",
          "fontSize": 10,
          "color": "#a0c8ff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -36,
          "pixelSize": 0.5
        },
        {
          "type": "heart",
          "x": 152,
          "y": 80,
          "w": 8,
          "h": 8
        },
        {
          "type": "platform",
          "x": 176,
          "y": 64,
          "w": 24,
          "h": 8
        },
        {
          "type": "trophy",
          "x": 182,
          "y": 50,
          "w": 12,
          "h": 14,
          "id": "lv1_cloud_echo_1"
        },
        {
          "type": "ice",
          "x": 248,
          "y": 80,
          "w": 24,
          "h": 8
        },
        {
          "type": "label",
          "x": 248,
          "y": 88,
          "w": 8,
          "h": 8,
          "text": "冰面打滑",
          "fontSize": 10,
          "color": "#88ddff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -36,
          "pixelSize": 0.5
        },
        {
          "type": "switch",
          "x": 300,
          "y": 92,
          "w": 16,
          "h": 4,
          "tags": "gateA"
        },
        {
          "type": "label",
          "x": 296,
          "y": 88,
          "w": 8,
          "h": 8,
          "text": "踩开关开门",
          "fontSize": 10,
          "color": "#00ddff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -36,
          "pixelSize": 0.5
        },
        {
          "type": "switchDoor",
          "x": 352,
          "y": 8,
          "w": 8,
          "h": 88,
          "tags": "gateA",
          "initialOpen": false,
          "orientation": "v"
        },
        {
          "type": "label",
          "x": 396,
          "y": 88,
          "w": 8,
          "h": 8,
          "text": "主动爆炸",
          "fontSize": 10,
          "color": "#ff8a5a",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -36,
          "pixelSize": 0.5
        },
        {
          "type": "movable",
          "x": 384,
          "y": 88,
          "w": 8,
          "h": 8
        },
        {
          "type": "plate",
          "x": 400,
          "y": 92,
          "w": 32,
          "h": 4,
          "need": 1,
          "targetId": "d1"
        },
        {
          "type": "door",
          "x": 440,
          "y": 68,
          "w": 8,
          "h": 28,
          "id": "d1",
          "orientation": "v"
        },
        {
          "type": "platform",
          "x": 416,
          "y": 72,
          "w": 20,
          "h": 8
        },
        {
          "type": "trophy",
          "x": 420,
          "y": 58,
          "w": 12,
          "h": 14,
          "id": "lv1_cloud_echo_2"
        },
        {
          "type": "goal",
          "x": 448,
          "y": 8,
          "w": 32,
          "h": 88
        }
      ],
      "initialLives": 3,
      "initialFlags": 0,
      "backgrounds": [
        {
          "id": "bg_sky",
          "layer": 0,
          "chambers": [
            {
              "id": "bc_sky",
              "x": -160,
              "y": -80,
              "w": 800,
              "h": 400
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc_sky",
              "x": -160,
              "y": -80,
              "w": 800,
              "h": 400,
              "shape": "rect",
              "shader": "gradient",
              "color": "#6fb3ef",
              "color2": "#dcefff",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.9,
              "rotation": 0,
              "points": 6,
              "speed": 0.4
            },
            {
              "type": "bgShape",
              "chamberId": "bc_sky",
              "x": 36,
              "y": 10,
              "w": 56,
              "h": 56,
              "shape": "circle",
              "shader": "gradient",
              "color": "#fff6c8",
              "color2": "#8fc4f0",
              "glowColor": "#fff0a0",
              "glowIntensity": 0.9,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.8
            }
          ]
        },
        {
          "id": "bg_mid",
          "layer": 1,
          "chambers": [
            {
              "id": "bc_mid",
              "x": -240,
              "y": -80,
              "w": 1200,
              "h": 400
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": -120,
              "y": 30,
              "w": 260,
              "h": 90,
              "shape": "presetMountainRange",
              "shader": "gradient",
              "color": "#8fb8e0",
              "color2": "#c6ddf5",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.55,
              "rotation": 0,
              "points": 6,
              "speed": 0.5
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": 100,
              "y": 36,
              "w": 240,
              "h": 84,
              "shape": "presetMountainRange",
              "shader": "gradient",
              "color": "#7faddb",
              "color2": "#bcd6f2",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": 300,
              "y": 30,
              "w": 260,
              "h": 90,
              "shape": "presetMountainRange",
              "shader": "gradient",
              "color": "#8fb8e0",
              "color2": "#c6ddf5",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.55,
              "rotation": 0,
              "points": 6,
              "speed": 0.5
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": 500,
              "y": 34,
              "w": 240,
              "h": 86,
              "shape": "presetMountainRange",
              "shader": "gradient",
              "color": "#7faddb",
              "color2": "#bcd6f2",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": -40,
              "y": 6,
              "w": 100,
              "h": 54,
              "shape": "presetCloud",
              "shader": "solid",
              "color": "#ffffff",
              "color2": "#e8f4ff",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 1.2
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": 160,
              "y": 16,
              "w": 120,
              "h": 64,
              "shape": "presetCloud",
              "shader": "solid",
              "color": "#ffffff",
              "color2": "#e8f4ff",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.45,
              "rotation": 0,
              "points": 6,
              "speed": 1.0
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": 360,
              "y": 4,
              "w": 110,
              "h": 58,
              "shape": "presetCloud",
              "shader": "solid",
              "color": "#ffffff",
              "color2": "#e8f4ff",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 1.3
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": 560,
              "y": 14,
              "w": 120,
              "h": 60,
              "shape": "presetCloud",
              "shader": "solid",
              "color": "#ffffff",
              "color2": "#e8f4ff",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.45,
              "rotation": 0,
              "points": 6,
              "speed": 0.9
            },
            {
              "type": "bgShape",
              "chamberId": "bc_mid",
              "x": -40,
              "y": 70,
              "w": 300,
              "h": 40,
              "shape": "rect",
              "shader": "ripples",
              "color": "#ffffff",
              "color2": "#bfe0ff",
              "glowColor": "#ffffff",
              "glowIntensity": 0.2,
              "alpha": 0.18,
              "rotation": 0,
              "points": 6,
              "speed": 1.5
            }
          ]
        },
        {
          "id": "bg_fg",
          "layer": 2,
          "chambers": [
            {
              "id": "bc_fg",
              "x": -160,
              "y": -40,
              "w": 800,
              "h": 260
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc_fg",
              "x": -20,
              "y": 34,
              "w": 150,
              "h": 62,
              "shape": "presetPineForest",
              "shader": "gradient",
              "color": "#2f6b46",
              "color2": "#1d4a30",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.7,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            },
            {
              "type": "bgShape",
              "chamberId": "bc_fg",
              "x": 150,
              "y": 30,
              "w": 150,
              "h": 66,
              "shape": "presetPineForest",
              "shader": "gradient",
              "color": "#2f6b46",
              "color2": "#1d4a30",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.7,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            },
            {
              "type": "bgShape",
              "chamberId": "bc_fg",
              "x": 320,
              "y": 34,
              "w": 150,
              "h": 62,
              "shape": "presetPineForest",
              "shader": "gradient",
              "color": "#2f6b46",
              "color2": "#1d4a30",
              "glowColor": "#ffffff",
              "glowIntensity": 0,
              "alpha": 0.7,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            }
          ]
        }
      ],
      "camera": {
        "deadZoneXLeft": 0.3,
        "deadZoneXRight": 0.7,
        "deadZoneYTop": 0.32,
        "deadZoneYBottom": 0.68,
        "viewW": 240,
        "viewH": 125
      },
      "feel": {
        "maxWalkSpeed": 1.85,
        "groundAccel": 0.3,
        "airAccel": 0.4,
        "stopFriction": 0.79,
        "jumpMinHeight": 12,
        "jumpMaxHeight": 24,
        "jumpMaxHoldTime": 0.4,
        "gravity": 0.76,
        "maxFallSpeed": 4,
        "coyoteTime": 0.5,
        "jumpBufferTime": 0.35,
        "edgeSnapDist": 1
      }
    },
    {
      "id": "lv2",
      "name": "潮汐实验室",
      "chambers": [
        {
          "id": "c1",
          "x": 0,
          "y": 0,
          "w": 600,
          "h": 160
        }
      ],
      "elements": [
        {
          "type": "platform",
          "x": 0,
          "y": 0,
          "w": 600,
          "h": 8
        },
        {
          "type": "platform",
          "x": 0,
          "y": 128,
          "w": 380,
          "h": 32
        },
        {
          "type": "platform",
          "x": 412,
          "y": 128,
          "w": 188,
          "h": 32
        },
        {
          "type": "platform",
          "x": 380,
          "y": 144,
          "w": 32,
          "h": 16
        },
        {
          "type": "spawn",
          "x": 24,
          "y": 128,
          "w": 8,
          "h": 8
        },
        {
          "type": "label",
          "x": 44,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "跳跃",
          "fontSize": 10,
          "color": "#ffffff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 35,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "fallingSpike",
          "x": 64,
          "y": 96,
          "w": 12,
          "h": 10,
          "triggerDelay": 1.2,
          "fallSpeed": 8,
          "triggerRange": 40
        },
        {
          "type": "label",
          "x": 70,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "倒刺：快速通过",
          "fontSize": 10,
          "color": "#ff8a5a",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "flagPickup",
          "x": 96,
          "y": 120,
          "w": 8,
          "h": 8
        },
        {
          "type": "label",
          "x": 96,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "插旗 / 拔旗",
          "fontSize": 10,
          "color": "#ffdd44",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "switch",
          "x": 128,
          "y": 124,
          "w": 16,
          "h": 4,
          "tags": "g2"
        },
        {
          "type": "label",
          "x": 120,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "踩开关开门",
          "fontSize": 10,
          "color": "#00ddff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "switchDoor",
          "x": 150,
          "y": 8,
          "w": 8,
          "h": 120,
          "tags": "g2",
          "initialOpen": false,
          "orientation": "v"
        },
        {
          "type": "water",
          "x": 158,
          "y": 112,
          "w": 36,
          "h": 16
        },
        {
          "type": "waterGrass",
          "x": 166,
          "y": 112,
          "w": 8,
          "h": 16,
          "color": "#44bb88",
          "segments": 12
        },
        {
          "type": "waterGrass",
          "x": 182,
          "y": 112,
          "w": 8,
          "h": 16,
          "color": "#44bb88",
          "segments": 12
        },
        {
          "type": "label",
          "x": 176,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "水下最多 10 秒",
          "fontSize": 10,
          "color": "#7fd0ff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "smoke",
          "x": 200,
          "y": 96,
          "w": 40,
          "h": 32
        },
        {
          "type": "label",
          "x": 220,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "幽灵照亮烟雾",
          "fontSize": 10,
          "color": "#dddddd",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "flammable",
          "x": 252,
          "y": 120,
          "w": 8,
          "h": 8,
          "burnTime": 1.5
        },
        {
          "type": "ice",
          "x": 260,
          "y": 120,
          "w": 16,
          "h": 8
        },
        {
          "type": "breakable",
          "x": 280,
          "y": 112,
          "w": 8,
          "h": 16
        },
        {
          "type": "trophy",
          "x": 294,
          "y": 114,
          "w": 12,
          "h": 14,
          "id": "lv2_tide_lab_1"
        },
        {
          "type": "label",
          "x": 276,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "爆炸引燃融冰",
          "fontSize": 10,
          "color": "#ff8a5a",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "movable",
          "x": 320,
          "y": 120,
          "w": 8,
          "h": 8
        },
        {
          "type": "plate",
          "x": 334,
          "y": 124,
          "w": 32,
          "h": 4,
          "need": 1,
          "targetId": "d2"
        },
        {
          "type": "door",
          "x": 370,
          "y": 88,
          "w": 8,
          "h": 40,
          "id": "d2",
          "orientation": "v"
        },
        {
          "type": "disappear",
          "x": 384,
          "y": 120,
          "w": 24,
          "h": 8,
          "onTime": 1.5,
          "offTime": 1.0,
          "phase": 0
        },
        {
          "type": "label",
          "x": 396,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "等待消失台出现",
          "fontSize": 10,
          "color": "#b0b0d0",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "laserDown",
          "x": 460,
          "y": 88,
          "w": 6,
          "h": 6,
          "dir": "down"
        },
        {
          "type": "label",
          "x": 452,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "跳过激光",
          "fontSize": 10,
          "color": "#ff5a7a",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "gravityFlip",
          "x": 496,
          "y": 72,
          "w": 48,
          "h": 40
        },
        {
          "type": "platform",
          "x": 496,
          "y": 64,
          "w": 48,
          "h": 8
        },
        {
          "type": "trophy",
          "x": 514,
          "y": 74,
          "w": 12,
          "h": 14,
          "id": "lv2_tide_lab_2"
        },
        {
          "type": "label",
          "x": 520,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "反向重力",
          "fontSize": 10,
          "color": "#c8a0ff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "lamp",
          "x": 552,
          "y": 96,
          "w": 8,
          "h": 32
        },
        {
          "type": "vine",
          "x": 546,
          "y": 100,
          "w": 3,
          "h": 28,
          "color": "#88ddaa",
          "segments": 8
        },
        {
          "type": "label",
          "x": 548,
          "y": 120,
          "w": 8,
          "h": 8,
          "text": "慢放幽灵",
          "fontSize": 10,
          "color": "#a0c8ff",
          "triggerRadius": 25,
          "fadeSpeed": 1.5,
          "textOffsetX": 0,
          "textOffsetY": -38,
          "pixelSize": 0.5
        },
        {
          "type": "platform",
          "x": 564,
          "y": 8,
          "w": 32,
          "h": 24
        },
        {
          "type": "goal",
          "x": 564,
          "y": 32,
          "w": 32,
          "h": 96
        }
      ],
      "initialLives": 3,
      "initialFlags": 0,
      "backgrounds": [
        {
          "id": "bg0",
          "layer": 0,
          "chambers": [
            {
              "id": "bc0",
              "x": -200,
              "y": -100,
              "w": 1000,
              "h": 500
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc0",
              "x": -200,
              "y": -100,
              "w": 1000,
              "h": 500,
              "shape": "rect",
              "shader": "gradient",
              "color": "#14304f",
              "color2": "#081527",
              "glowColor": "#2aa6c8",
              "glowIntensity": 0,
              "alpha": 0.95,
              "rotation": 0,
              "points": 6,
              "speed": 0.3
            },
            {
              "type": "bgShape",
              "chamberId": "bc0",
              "x": -40,
              "y": 0,
              "w": 340,
              "h": 140,
              "shape": "rect",
              "shader": "caustics",
              "color": "#2aa6c8",
              "color2": "#0a2a44",
              "glowColor": "#7fe6ff",
              "glowIntensity": 0.4,
              "alpha": 0.22,
              "rotation": 0,
              "points": 6,
              "speed": 1.2
            }
          ]
        },
        {
          "id": "bg1",
          "layer": 1,
          "chambers": [
            {
              "id": "bc1",
              "x": -240,
              "y": -100,
              "w": 1200,
              "h": 500
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc1",
              "x": -120,
              "y": 40,
              "w": 200,
              "h": 90,
              "shape": "presetRuins",
              "shader": "gradient",
              "color": "#2c4f74",
              "color2": "#16283f",
              "glowColor": "#5fd0ff",
              "glowIntensity": 0.1,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            },
            {
              "type": "bgShape",
              "chamberId": "bc1",
              "x": 80,
              "y": 20,
              "w": 70,
              "h": 110,
              "shape": "presetTower",
              "shader": "gradient",
              "color": "#356089",
              "color2": "#18314c",
              "glowColor": "#5fd0ff",
              "glowIntensity": 0.1,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.5
            },
            {
              "type": "bgShape",
              "chamberId": "bc1",
              "x": 220,
              "y": 44,
              "w": 200,
              "h": 86,
              "shape": "presetRuins",
              "shader": "gradient",
              "color": "#2c4f74",
              "color2": "#16283f",
              "glowColor": "#5fd0ff",
              "glowIntensity": 0.1,
              "alpha": 0.48,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            },
            {
              "type": "bgShape",
              "chamberId": "bc1",
              "x": 420,
              "y": 24,
              "w": 70,
              "h": 106,
              "shape": "presetTower",
              "shader": "gradient",
              "color": "#356089",
              "color2": "#18314c",
              "glowColor": "#5fd0ff",
              "glowIntensity": 0.1,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.5
            },
            {
              "type": "bgShape",
              "chamberId": "bc1",
              "x": 520,
              "y": 40,
              "w": 200,
              "h": 90,
              "shape": "presetRuins",
              "shader": "gradient",
              "color": "#2c4f74",
              "color2": "#16283f",
              "glowColor": "#5fd0ff",
              "glowIntensity": 0.1,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.6
            }
          ]
        },
        {
          "id": "bg2",
          "layer": 2,
          "chambers": [
            {
              "id": "bc2",
              "x": -240,
              "y": -100,
              "w": 1200,
              "h": 500
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc2",
              "x": 40,
              "y": 30,
              "w": 64,
              "h": 100,
              "shape": "presetTower",
              "shader": "gradient",
              "color": "#3d6f9a",
              "color2": "#1b3550",
              "glowColor": "#7fe6ff",
              "glowIntensity": 0.15,
              "alpha": 0.42,
              "rotation": 0,
              "points": 6,
              "speed": 0.4
            },
            {
              "type": "bgShape",
              "chamberId": "bc2",
              "x": 180,
              "y": 60,
              "w": 90,
              "h": 70,
              "shape": "triangle",
              "shader": "gradient",
              "color": "#2f5d86",
              "color2": "#16304a",
              "glowColor": "#7fe6ff",
              "glowIntensity": 0.15,
              "alpha": 0.4,
              "rotation": 0,
              "points": 3,
              "speed": 0.5
            },
            {
              "type": "bgShape",
              "chamberId": "bc2",
              "x": 340,
              "y": 26,
              "w": 64,
              "h": 104,
              "shape": "presetTower",
              "shader": "gradient",
              "color": "#3d6f9a",
              "color2": "#1b3550",
              "glowColor": "#7fe6ff",
              "glowIntensity": 0.15,
              "alpha": 0.42,
              "rotation": 0,
              "points": 6,
              "speed": 0.4
            },
            {
              "type": "bgShape",
              "chamberId": "bc2",
              "x": -60,
              "y": 80,
              "w": 360,
              "h": 60,
              "shape": "rect",
              "shader": "ripples",
              "color": "#7fe6ff",
              "color2": "#1d4a66",
              "glowColor": "#aef0ff",
              "glowIntensity": 0.3,
              "alpha": 0.16,
              "rotation": 0,
              "points": 6,
              "speed": 1.4
            }
          ]
        },
        {
          "id": "bg3",
          "layer": 3,
          "chambers": [
            {
              "id": "bc3",
              "x": -160,
              "y": -80,
              "w": 1000,
              "h": 400
            }
          ],
          "shapes": [
            {
              "type": "bgShape",
              "chamberId": "bc3",
              "x": 60,
              "y": 40,
              "w": 56,
              "h": 88,
              "shape": "presetTower",
              "shader": "gradient",
              "color": "#4a86b4",
              "color2": "#20405e",
              "glowColor": "#aef0ff",
              "glowIntensity": 0.2,
              "alpha": 0.55,
              "rotation": 0,
              "points": 6,
              "speed": 0.3
            },
            {
              "type": "bgShape",
              "chamberId": "bc3",
              "x": 430,
              "y": 60,
              "w": 70,
              "h": 68,
              "shape": "rect",
              "shader": "gradient",
              "color": "#4a86b4",
              "color2": "#20405e",
              "glowColor": "#aef0ff",
              "glowIntensity": 0.2,
              "alpha": 0.5,
              "rotation": 0,
              "points": 6,
              "speed": 0.3
            }
          ]
        }
      ],
      "camera": {
        "deadZoneXLeft": 0.3,
        "deadZoneXRight": 0.7,
        "deadZoneYTop": 0.32,
        "deadZoneYBottom": 0.68,
        "viewW": 300,
        "viewH": 150
      },
      "feel": {
        "maxWalkSpeed": 1.85,
        "groundAccel": 0.3,
        "airAccel": 0.4,
        "stopFriction": 0.79,
        "jumpMinHeight": 12,
        "jumpMaxHeight": 24,
        "jumpMaxHoldTime": 0.4,
        "gravity": 0.76,
        "maxFallSpeed": 4,
        "coyoteTime": 0.5,
        "jumpBufferTime": 0.35,
        "edgeSnapDist": 1
      }
    }
  ]
};
