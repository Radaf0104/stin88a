// Everything a non-programmer should need to change lives in this file.
export const CONFIG = {
  project: {
    name: "STIN 88A",
    tagline: { en: "Modern living rooms · Pick a floor, pick your room", id: "Hunian modern · Pilih lantai, pilih kamar" },
  },

  // WhatsApp number in international format without "+" or spaces, e.g. "6281234567890".
  // Leave empty to hide the WhatsApp button.
  whatsapp: "",

  defaultLanguage: "en", // "en" or "id"

  // ---- Real map (Google Photorealistic 3D Tiles) ----
  // Paste your Google Maps Platform API key here (Map Tiles API enabled; restrict it to your website addresses).
  googleMapsKey: "-6.614033, 106.887443",
  site: {
    lat: -6.614033, lon: 106.887443, // plot location
    // Turns the surroundings so true north matches the model. The front (terrace/canopy side) faces a bearing of
    // ~164° (south-south-east). If the map looks rotated, adjust this number (degrees).
    northRotation: 164,
    groundLevel: -0.15, // terrain under the site is snapped to this height (m, model's Ground level)
  },

  // Room types. Prices are monthly, in IDR. PLACEHOLDER prices - change them.
  // "gallery" = which interior photo set the room card's "Room photos" button opens (see galleries below).
  // Optional "pano": a 360° image (2:1 equirectangular JPG) - adds a "360° view" button.
  types: {
    // pano: 360° image; panoStart: which way the view faces when it opens (degrees, try 0–359); panoPitch: max look up/down
    standard: { label: { en: "3 m Room", id: "Kamar 3 m" }, price: 2500000, gallery: "room3", pano: "images/pano/room3.webp", panoStart: 125, panoPitch: 45 },
    deluxe: { label: { en: "3.5 m Room", id: "Kamar 3,5 m" }, price: 3000000, gallery: "room35", pano: "images/pano/room35.jpg", panoStart: 290, panoPitch: 45 },
    suite: { label: { en: "Corner Suite", id: "Suite Sudut" }, price: 4000000, gallery: "room35" },
  },

  // Corridor photo shown with the room photos, per floor (files in images/interiors/shared/).
  corridors: { 3: "09.jpg", 4: "10.jpg" },

  // Interior photo sets (tabs in the gallery after "Exterior"). Files: <dir>/NN.jpg, thumbnails in <dir>/thumbs/.
  galleries: [
    {
      key: "room3", label: { en: "3 m Room", id: "Kamar 3 m" }, dir: "images/interiors/room3/",
      items: [
        { file: "01.jpg", title: { en: "Bedroom", id: "Kamar tidur" } },
        { file: "02.jpg", title: { en: "Bed & balcony", id: "Tempat tidur & balkon" } },
        { file: "03.jpg", title: { en: "Room overview", id: "Tampak kamar" } },
        { file: "04.jpg", title: { en: "Entry", id: "Pintu masuk" } },
        { file: "05.webp", title: { en: "TV wall", id: "Dinding TV" } },
        { file: "06.jpg", title: { en: "Bathroom", id: "Kamar mandi" }, zone: "bath" },
        { file: "07.jpg", title: { en: "Bathroom", id: "Kamar mandi" }, zone: "bath" },
      ],
    },
    {
      key: "room35", label: { en: "3.5 m Room", id: "Kamar 3,5 m" }, dir: "images/interiors/room35/",
      items: [
        { file: "01.jpg", title: { en: "Bedroom", id: "Kamar tidur" } },
        { file: "02.jpg", title: { en: "Bed & balcony", id: "Tempat tidur & balkon" } },
        { file: "03.jpg", title: { en: "Room overview", id: "Tampak kamar" } },
        { file: "04.jpg", title: { en: "TV wall", id: "Dinding TV" } },
        { file: "05.webp", title: { en: "Entry", id: "Pintu masuk" } },
        { file: "06.jpg", title: { en: "Bathroom", id: "Kamar mandi" }, zone: "bath" },
        { file: "07.jpg", title: { en: "Bathroom", id: "Kamar mandi" }, zone: "bath" },
      ],
    },
    {
      key: "shared", label: { en: "Facilities", id: "Fasilitas" }, dir: "images/interiors/shared/",
      items: [
        { file: "01.jpg", title: { en: "Communal living & dining", id: "Ruang makan bersama" }, zone: "living" },
        { file: "02.jpg", title: { en: "Communal dining · garden view", id: "Ruang makan · view taman" }, zone: "living" },
        { file: "03.jpg", title: { en: "Communal living & stair", id: "Ruang bersama & tangga" }, zone: "living" },
        { file: "04.jpg", title: { en: "Dining corner", id: "Sudut makan" }, zone: "living" },
        { file: "05.jpg", title: { en: "Communal terrace", id: "Teras komunal" }, zone: "terrace" },
        { file: "06.jpg", title: { en: "Communal terrace · hill view", id: "Teras komunal · view bukit" }, zone: "terrace" },
        { file: "07.jpg", title: { en: "Terrace from above", id: "Teras dari atas" }, zone: "terrace" },
        { file: "08.jpg", title: { en: "Terrace lounge", id: "Lounge teras" }, zone: "terrace" },
        { file: "09.jpg", title: { en: "Corridor · Level 3", id: "Koridor · Lantai 3" }, zone: "corridor" },
        { file: "10.jpg", title: { en: "Corridor · Level 4", id: "Koridor · Lantai 4" }, zone: "corridor" },
      ],
    },
    {
      key: "villa", label: { en: "Private Villa", id: "Villa Pribadi" }, dir: "images/interiors/villa/",
      items: [
        { file: "01.jpg", title: { en: "Villa pool", id: "Kolam villa" } },
        { file: "02.jpg", title: { en: "Pool & living room", id: "Kolam & ruang keluarga" } },
        { file: "03.jpg", title: { en: "Pool courtyard", id: "Taman kolam" } },
      ],
    },
  ],

  // Exterior renders (images/renders/). The first one is the landing-page image.
  // az / el = where the camera stands, in degrees: az 0 = south (terrace side), 90 = east, 180 = north, 270 = west;
  // el = height angle. dist = how far away (1 = normal). Used to fly the 3D view to the same angle as the render.
  renders: [
    { file: "r01.jpg", title: { en: "Aerial view", id: "Tampak udara" }, az: -38, el: 36, dist: 2.2 },
    { file: "r02.jpg", title: { en: "Terrace facade", id: "Fasad sisi teras" }, az: 0, el: 3, dist: 1.6 },
    { file: "r03.jpg", title: { en: "Terrace facade · evening light", id: "Fasad sisi teras · sore" }, az: 0, el: 3, dist: 1.6 },
    { file: "r04.jpg", title: { en: "Corner view", id: "Tampak sudut" }, az: 225, el: 6, dist: 1.7 },
    { file: "r05.jpg", title: { en: "Corner view · terrace", id: "Tampak sudut · teras" }, az: 45, el: 6, dist: 1.7 },
    { file: "r06.jpg", title: { en: "Communal terrace from above", id: "Teras komunal dari atas" }, az: 12, el: 38, dist: 1.2 },
    { file: "r07.jpg", title: { en: "Communal terrace", id: "Teras komunal" }, az: 65, el: 7, dist: 1.1 },
    { file: "r08.jpg", title: { en: "Upper floors", id: "Lantai atas" }, az: 160, el: 14, dist: 1.2 },
    { file: "r09.jpg", title: { en: "Rear facade", id: "Fasad belakang" }, az: 150, el: 6, dist: 1.7 },
    { file: "r10.jpg", title: { en: "Villa house entrance", id: "Pintu masuk villa" }, az: 270, el: 4, dist: 1.4 },
    { file: "r11.jpg", title: { en: "Balcony detail", id: "Detail balkon" }, az: 0, el: 22, dist: 0.9 },
  ],

  // Floors shown in the floor picker (Revit level index -> label).
  floors: [
    { level: 4, label: { en: "Level 4", id: "Lantai 4" } },
    { level: 3, label: { en: "Level 3", id: "Lantai 3" } },
    { level: 2, label: { en: "Level 2", id: "Lantai 2" } },
    { level: 1, label: { en: "Level 1", id: "Lantai 1" } },
  ],

  // Shared spaces shown as clickable volumes (matched to Revit rooms by name). "gallery" + "start" = which photos open.
  spaces: [
    // pano / panoStart / panoPitch: optional 360° view, same as for the room types above
    { room: "AREA KOMUNAL", label: { en: "Communal living & dining", id: "Ruang bersama" }, gallery: "shared", start: 0, zone: "living",
      pano: "images/pano/lobby_l1.webp", panoStart: 180, panoPitch: 45,
      text: { en: "Shared lounge, dining table and terrace for all residents.", id: "Ruang santai, meja makan dan teras untuk semua penghuni." } },
    { room: "OPEN LIVING ROOM", label: { en: "Private villa", id: "Villa pribadi" }, gallery: "villa", start: 0,
      text: { en: "The owner's private villa with its own pool courtyard.", id: "Villa pribadi pemilik dengan taman kolam sendiri." } },
  ],
};
