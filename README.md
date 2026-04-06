# RH Learning Assistant

A Chrome Extension (Manifest V3) that helps you learn from Red Hat Learning videos using Google's Gemini AI. Summarize, chat, and quiz with interactive flashcards.

## Features

- Automatically captures video transcripts from Kaltura-powered videos
- Summarizes content with key concepts, commands, and practical takeaways
- Interactive flashcards to test your knowledge with score tracking and retest
- Clean, modern UI injected directly into the page
- Secure API key storage in browser local storage
- Works only for authenticated users with existing course access

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the cloned repository folder (e.g. `RH-Learning-AI-Assistant`)

### Getting a Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key and save it in the extension

## Usage

1. Navigate to [Red Hat Learning](https://role.rhu.redhat.com) and log in
2. Open any video course
3. **Play the video** (this triggers transcript loading)
4. Click the **Summarize Video** button (bottom-right corner)
5. Enter your Gemini API key if prompted
6. View your summary with:
   - Key Concepts
   - Commands Mentioned
   - Practical Takeaways

## File Structure

```
RH-Learning-AI-Assistant/
├── manifest.json       # Extension configuration
├── background.js       # Service worker for message passing
├── content.js          # Main content script
├── injected.js         # Fetch interceptor for transcript capture
├── styles.css          # UI styling
├── popup.html          # Settings popup
├── popup.js            # Popup logic
├── generate-icons.js   # Icon generation script
└── icons/
    ├── icon.svg        # Source icon
    ├── icon16.png      # 16x16 icon
    ├── icon48.png      # 48x48 icon
    └── icon128.png     # 128x128 icon
```

## How It Works

1. **Transcript Capture**: The extension injects a script that intercepts network requests to the Kaltura API, capturing transcript data when the video loads.

2. **Text Processing**: Transcripts are cleaned to remove timestamps and normalize whitespace while preserving sentence boundaries.

3. **AI Summarization**: The cleaned transcript is sent to Google's Gemini 2.5 Flash model with a structured prompt to generate organized summaries.

4. **Chunking**: Large transcripts are automatically split into chunks, summarized individually, then combined into a cohesive summary.

## Privacy & Security

- **No authentication bypass** - Only works for users already logged into Red Hat Learning
- **No data storage** - Transcripts are processed in memory and never stored outside the browser
- **API key security** - Your Gemini API key is stored locally in Chrome's secure storage
- **No server** - All processing happens client-side in your browser

## Troubleshooting

### "No transcript found"
- Make sure you've played the video first
- Try refreshing the page and playing again
- Some videos may not have transcripts available

### "Invalid API key"
- Verify your key starts with "AI"
- Try generating a new key from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Check that you haven't exceeded your API quota

### Button not appearing
- Verify you're on `role.rhu.redhat.com`
- Check that the extension is enabled in `chrome://extensions/`
- Try refreshing the page

## Development

### Regenerating Icons

If you need to regenerate the icons:

```bash
# Using ImageMagick
cd icons
convert -background none icon.svg -resize 16x16 icon16.png
convert -background none icon.svg -resize 48x48 icon48.png
convert -background none icon.svg -resize 128x128 icon128.png

# Or using Node.js (requires canvas module)
npm install canvas
node generate-icons.js
```

### Testing Changes

1. Make your code changes
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload the Red Hat Learning page

## License

This extension is provided as-is for educational purposes. Use responsibly and in accordance with Red Hat Learning's terms of service.

## Disclaimer

This is an unofficial tool and is not affiliated with or endorsed by Red Hat, Inc. It is designed to help learners better understand course content they already have legitimate access to.
