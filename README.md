# Linguist App - Chinese Dictionary & Handwriting Recognition

A comprehensive Angular application designed to help linguists with Chinese language research, featuring handwriting recognition and dictionary lookup using the CC-CEDICT dictionary from MDBG.

## Features

### 🖊️ Handwriting Recognition
- Draw Chinese characters directly on the screen
- Tolerant of stroke order mistakes
- Real-time character recognition
- Integration with CC-CEDICT dictionary for instant lookup

### 📚 Dictionary Integration
- Powered by [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) from MDBG
- Lookup words by drawing or typing
- Shows traditional and simplified characters
- Displays pinyin pronunciation and definitions

### 🔤 Radicals & Strokes Lookup
- Browse Chinese radicals organized by stroke count
- Based on [MDBG's radical table](https://www.mdbg.net/chinese/dictionary?page=radicals)
- Click radicals to find characters containing them
- Filter by stroke count

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
npm install

# Set up the embedded dictionary (required before first run)
npm run setup-dictionary
```

### Development

```bash
npm start
```

The app will be available at `http://localhost:4200`

### Build

```bash
npm run build
```

## Tech Stack

- Angular 17
- TypeScript
- Standalone Components
- Embedded CC-CEDICT dictionary (no external API calls)
- HttpClient for loading local dictionary data

## Dictionary Data

This app uses the **embedded CC-CEDICT dictionary** - no external API calls are made. The dictionary is:
- Licensed under Creative Commons Attribution-ShareAlike 4.0 International License
- Contains over 124,000 entries
- Embedded directly in the app for offline use
- Updated regularly by the community

### Setting Up the Dictionary

The dictionary needs to be downloaded and parsed before first use:

```bash
# Download the CC-CEDICT dictionary
curl -L -o cedict_ts.u8.gz "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"

# Parse it into JSON format
node scripts/parse-cedict.js cedict_ts.u8.gz src/assets/cedict.json
```

The parsed dictionary will be placed in `src/assets/cedict.json` and automatically loaded by the app.

## Handwriting Recognition

The handwriting recognition feature allows you to:
1. Draw characters on the canvas with mouse or touch
2. The system is tolerant of stroke order variations
3. Characters can be recognized and looked up in the dictionary

**Note:** For production use, you may want to integrate with a specialized handwriting recognition API such as:
- Google Cloud Vision API
- Microsoft Azure Computer Vision
- Or a dedicated Chinese handwriting recognition service

## Future Enhancements

- Direct integration with handwriting recognition APIs
- Offline dictionary support
- Character stroke order animation
- Audio pronunciation
- Export field notes
- Advanced search filters

## License

This project is open source. The dictionary data (CC-CEDICT) is licensed under Creative Commons Attribution-ShareAlike 4.0 International License.
