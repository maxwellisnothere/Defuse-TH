// ไฟล์: utils/csItemParser.js

const CS2_APP_ID = 730;
const CS2_CONTEXT_ID = 2;

const RARITY_COLORS = {
  'Consumer Grade': '#B0C3D9',
  'Industrial Grade': '#5E98D9',
  'Mil-Spec Grade': '#4B69FF',
  'Restricted': '#8847FF',
  'Classified': '#D32CE6',
  'Covert': '#EB4B4B',
  'Contraband': '#E4AE33',
  'Extraordinary': '#E4AE33',
  'Base Grade': '#B0C3D9',
};

// 🔥 เพิ่ม WEAR_MAP เข้ามาตรงนี้ครับ
const WEAR_MAP = {
  'Factory New': 'FN',
  'Minimal Wear': 'MW',
  'Field-Tested': 'FT',
  'Well-Worn': 'WW',
  'Battle-Scarred': 'BS',
};

const parseItem = (asset, description, steamId) => {
  if (!description) return null;

  const tags = description.tags || [];
  const getTag = (cat) => tags.find(t => t.category === cat)?.localized_tag_name || null;

  const rarity = getTag('Rarity') || 'Base Grade';
  const wear = getTag('Exterior');
  const type = getTag('Weapon') || getTag('Type') || 'Unknown';
  const collection = getTag('Collection');

  const name = description.market_hash_name || description.name || 'Unknown';

  // แยกชื่อ
  const parts = name.split(' | ');
  const weapon = parts[0]?.replace('StatTrak™ ', '').replace('Souvenir ', '').trim() || name;
  const skinRaw = parts[1] || '';
  const skin = skinRaw.replace(/\s*\(.*\)/, '').trim() || name;

  const isStatTrak = name.includes('StatTrak™');
  const isSouvenir = name.includes('Souvenir');

  const imageUrl = description.icon_url
    ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}/360fx360f`
    : null;

  // 🔥 ลอจิก INSPECT LINK
  let inspectLink = null;
  if (description.actions && description.actions.length > 0) {
    inspectLink = description.actions[0].link
      ?.replace('%owner_steamid%', asset.owner || steamId)
      ?.replace('%assetid%', asset.assetid);
  }

  // 🎯 ลอจิก STICKERS (ทำความสะอาด HTML)
  const stickers = description.descriptions
    ?.filter(d => d.value?.includes('Sticker:'))
    ?.map(d => d.value.replace(/<[^>]*>?/gm, '').trim()) || []; 

  // หมวดหมู่
  let category = 'Guns';
  if (name.includes('Gloves') || name.includes('Wraps')) category = 'Glove';
  else if (['Knife', 'Karambit', 'Bayonet', 'Butterfly', 'Falchion', 'Flip', 'Gut ', 'Huntsman', 'M9 ', 'Navaja', 'Shadow', 'Stiletto', 'Talon', 'Ursus'].some(k => name.includes(k))) category = 'Knife';
  else if (['Case', 'Capsule', 'Package', 'Sticker', 'Graffiti', 'Patch', 'Music Kit'].some(k => name.includes(k))) category = 'Cases';

  // คืนค่ารูปแบบที่พร้อมใช้งาน
  return {
    assetId: asset.assetid,
    name: name,
    marketHashName: description.market_hash_name || name,
    weapon: weapon,
    skin: skin,
    rarity: rarity,
    rarityColor: RARITY_COLORS[rarity] || '#B0C3D9',
    wear: wear || null,
    wearShort: wear ? (WEAR_MAP[wear] || wear) : null,
    float: null, 
    image: imageUrl,
    category: category,
    stattrak: isStatTrak,
    souvenir: isSouvenir,
    tradeLock: description.tradable === 0,
    marketable: description.marketable === 1,
    listed: false,
    listingId: null,
    acquiredAt: new Date(),
    inspectLink: inspectLink,
    stickers: stickers,
    collectionName: collection
  };
};

// 🔥 บรรทัดนี้สำคัญมาก! ส่งออกเพื่อให้ไฟล์อื่นดึงไปใช้ได้
module.exports = {
  CS2_APP_ID,
  CS2_CONTEXT_ID,
  parseItem
};