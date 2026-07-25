/**
 * 变变素材 — 从 @tabler/icons-vue 中精选适合儿童的图标
 * 运行：node scripts/generate-materials.mjs
 */

// 精选图标列表：{ id, name, category, iconName }
// iconName 对应 @tabler/icons-vue 的导出名称（已在 node_modules 中验证存在）
const SELECTED_ICONS = [
  // ===== 动物 (animal) =====
  { id: 'animal-1',  name: '小猫',   category: 'animal', iconName: 'IconCat' },
  { id: 'animal-2',  name: '小狗',   category: 'animal', iconName: 'IconDog' },
  { id: 'animal-11', name: '小鱼',   category: 'animal', iconName: 'IconFish' },
  { id: 'animal-12', name: '蝴蝶',   category: 'animal', iconName: 'IconButterfly' },
  { id: 'animal-13', name: '螃蟹',   category: 'animal', iconName: 'IconCrab' },
  { id: 'animal-14', name: '蜗牛',   category: 'animal', iconName: 'IconSnail' },
  { id: 'animal-15', name: '蛇',     category: 'animal', iconName: 'IconSnake' },
  { id: 'animal-16', name: '毛毛虫', category: 'animal', iconName: 'IconBug' },
  { id: 'animal-17', name: '蚂蚁',   category: 'animal', iconName: 'IconAntenna' },
  { id: 'animal-18', name: '马',     category: 'animal', iconName: 'IconHorse' },

  // ===== 自然 (nature) =====
  { id: 'nature-1',  name: '太阳',   category: 'nature', iconName: 'IconSun' },
  { id: 'nature-2',  name: '月亮',   category: 'nature', iconName: 'IconMoon' },
  { id: 'nature-3',  name: '星星',   category: 'nature', iconName: 'IconStar' },
  { id: 'nature-4',  name: '云朵',   category: 'nature', iconName: 'IconCloud' },
  { id: 'nature-5',  name: '彩虹',   category: 'nature', iconName: 'IconRainbow' },
  { id: 'nature-6',  name: '花朵',   category: 'nature', iconName: 'IconFlower' },
  { id: 'nature-7',  name: '大树',   category: 'nature', iconName: 'IconTree' },
  { id: 'nature-8',  name: '蘑菇',   category: 'nature', iconName: 'IconMushroom' },
  { id: 'nature-9',  name: '叶子',   category: 'nature', iconName: 'IconLeaf' },
  { id: 'nature-10', name: '雪花',   category: 'nature', iconName: 'IconSnowflake' },
  { id: 'nature-11', name: '火焰',   category: 'nature', iconName: 'IconFlame' },
  { id: 'nature-12', name: '水滴',   category: 'nature', iconName: 'IconDroplet' },
  { id: 'nature-13', name: '闪电',   category: 'nature', iconName: 'IconBolt' },
  { id: 'nature-14', name: '旋风',   category: 'nature', iconName: 'IconWind' },

  // ===== 食物 (food) =====
  { id: 'food-1',    name: '蛋糕',   category: 'food', iconName: 'IconCake' },
  { id: 'food-2',    name: '冰淇淋', category: 'food', iconName: 'IconIceCream' },
  { id: 'food-3',    name: '棒棒糖', category: 'food', iconName: 'IconCandy' },
  { id: 'food-4',    name: '苹果',   category: 'food', iconName: 'IconApple' },
  { id: 'food-6',    name: '饼干',   category: 'food', iconName: 'IconCookie' },
  { id: 'food-7',    name: '披萨',   category: 'food', iconName: 'IconPizza' },
  { id: 'food-9',    name: '葡萄',   category: 'food', iconName: 'IconGrape' },
  { id: 'food-10',   name: '柠檬',   category: 'food', iconName: 'IconLemon' },
  { id: 'food-11',   name: '樱桃',   category: 'food', iconName: 'IconCherry' },
  { id: 'food-12',   name: '咖啡',   category: 'food', iconName: 'IconCoffee' },
  { id: 'food-13',   name: '牛奶',   category: 'food', iconName: 'IconMilk' },
  { id: 'food-14',   name: '鸡蛋',   category: 'food', iconName: 'IconEgg' },

  // ===== 交通 (transport) =====
  { id: 'trans-1',   name: '火箭',   category: 'transport', iconName: 'IconRocket' },
  { id: 'trans-2',   name: '飞机',   category: 'transport', iconName: 'IconPlane' },
  { id: 'trans-3',   name: '汽车',   category: 'transport', iconName: 'IconCar' },
  { id: 'trans-4',   name: '火车',   category: 'transport', iconName: 'IconTrain' },
  { id: 'trans-5',   name: '轮船',   category: 'transport', iconName: 'IconShip' },
  { id: 'trans-7',   name: '直升机', category: 'transport', iconName: 'IconHelicopter' },
  { id: 'trans-8',   name: '热气球', category: 'transport', iconName: 'IconBalloon' },
  { id: 'trans-9',   name: '帆船',   category: 'transport', iconName: 'IconSailboat' },
  { id: 'trans-10',  name: '摩托车', category: 'transport', iconName: 'IconMotorcycle' },
  { id: 'trans-11',  name: '巴士',   category: 'transport', iconName: 'IconBus' },

  // ===== 贴纸 (sticker) =====
  { id: 'sticker-1', name: '礼物',   category: 'sticker', iconName: 'IconGift' },
  { id: 'sticker-2', name: '皇冠',   category: 'sticker', iconName: 'IconCrown' },
  { id: 'sticker-3', name: '气球',   category: 'sticker', iconName: 'IconBalloonFilled' },
  { id: 'sticker-4', name: '音符',   category: 'sticker', iconName: 'IconMusic' },
  { id: 'sticker-5', name: '星星魔法', category: 'sticker', iconName: 'IconSparkles' },
  { id: 'sticker-6', name: '奖杯',   category: 'sticker', iconName: 'IconTrophy' },
  { id: 'sticker-7', name: '钻石',   category: 'sticker', iconName: 'IconDiamond' },
  { id: 'sticker-8', name: '旗帜',   category: 'sticker', iconName: 'IconFlag' },
  { id: 'sticker-9', name: '星星',   category: 'sticker', iconName: 'IconStarFilled' },
  { id: 'sticker-10', name: '爱心',   category: 'sticker', iconName: 'IconHeart' },
  { id: 'sticker-11', name: '相机',   category: 'sticker', iconName: 'IconCamera' },
  { id: 'sticker-12', name: '书本',   category: 'sticker', iconName: 'IconBook' },
  { id: 'sticker-13', name: '钥匙',   category: 'sticker', iconName: 'IconKey' },
  { id: 'sticker-14', name: '放大镜', category: 'sticker', iconName: 'IconSearch' },
  { id: 'sticker-15', name: '房屋',   category: 'sticker', iconName: 'IconHome' },
  { id: 'sticker-16', name: '钟表',   category: 'sticker', iconName: 'IconClock' },
  { id: 'sticker-17', name: '地球',   category: 'sticker', iconName: 'IconPlanet' },
  { id: 'sticker-18', name: '王冠',   category: 'sticker', iconName: 'IconCrownOff' },
  { id: 'sticker-19', name: '魔法',   category: 'sticker', iconName: 'IconWand' },
  { id: 'sticker-20', name: '笑脸',   category: 'sticker', iconName: 'IconMoodSmile' },
  { id: 'sticker-21', name: '哭脸',   category: 'sticker', iconName: 'IconMoodSad' },
  { id: 'sticker-22', name: '惊讶',   category: 'sticker', iconName: 'IconMoodSurprised' },
  { id: 'sticker-23', name: '开心',   category: 'sticker', iconName: 'IconMoodHappy' },
  { id: 'sticker-24', name: '亲亲',   category: 'sticker', iconName: 'IconMoodKiss' },
  { id: 'sticker-25', name: '眨眼',   category: 'sticker', iconName: 'IconMoodWink' },
  { id: 'sticker-26', name: '酷',     category: 'sticker', iconName: 'IconMoodCool' },
  { id: 'sticker-27', name: '帅气',   category: 'sticker', iconName: 'IconMoodBoy' },
  { id: 'sticker-28', name: '可爱',   category: 'sticker', iconName: 'IconMoodKid' },
  { id: 'sticker-29', name: '电话',   category: 'sticker', iconName: 'IconPhone' },
  { id: 'sticker-30', name: '邮件',   category: 'sticker', iconName: 'IconMail' },

  // ===== 形状 (shape) =====
  { id: 'shape-1',   name: '圆形',   category: 'shape', iconName: 'IconCircle' },
  { id: 'shape-2',   name: '方形',   category: 'shape', iconName: 'IconSquare' },
  { id: 'shape-3',   name: '三角',   category: 'shape', iconName: 'IconTriangle' },
  { id: 'shape-4',   name: '爱心',   category: 'shape', iconName: 'IconHeartFilled' },
  { id: 'shape-5',   name: '星形',   category: 'shape', iconName: 'IconStarFilled' },
  { id: 'shape-6',   name: '菱形',   category: 'shape', iconName: 'IconDiamondFilled' },
  { id: 'shape-7',   name: '六边形', category: 'shape', iconName: 'IconHexagon' },
  { id: 'shape-8',   name: '五边形', category: 'shape', iconName: 'IconPentagon' },
  { id: 'shape-9',   name: '箭头上', category: 'shape', iconName: 'IconArrowUp' },
  { id: 'shape-10',  name: '箭头下', category: 'shape', iconName: 'IconArrowDown' },
  { id: 'shape-11',  name: '箭头左', category: 'shape', iconName: 'IconArrowLeft' },
  { id: 'shape-12',  name: '箭头右', category: 'shape', iconName: 'IconArrowRight' },
  { id: 'shape-13',  name: '新月',   category: 'shape', iconName: 'IconCrescent' },
  { id: 'shape-14',  name: '十字',   category: 'shape', iconName: 'IconPlus' },
];

export default SELECTED_ICONS;
