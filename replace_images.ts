import * as fs from 'fs';
const path = 'src/App.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldBlock = `          // Generate images
          for (const slide of parsed.slides) {
            if (slide.data.imagePrompt) {
              try {
                const imgResponse = await generateImagesWithRetry({
                  model: 'imagen-3.0-generate-001',
                  prompt: slide.data.imagePrompt + " (do not include any text, words, or letters in the image)",
                  config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: '16:9'
                  }
                });
                if (imgResponse.generatedImages && imgResponse.generatedImages.length > 0) {
                  slide.data.imageUrl = \`data:image/jpeg;base64,\${imgResponse.generatedImages[0].image.imageBytes}\`;
                }
              } catch (imgError) {
                console.error("Failed to generate image for slide", imgError);
              }
            }
          }`;

const newBlock = `          // Retrieve illustrations
          for (const slide of parsed.slides) {
            if (slide.data.illustrationQuery) {
              slide.data.imageUrl = getImageUrl(slide.data.illustrationQuery, 800, 450);
            }
          }`;

content = content.replaceAll(oldBlock, newBlock);
fs.writeFileSync(path, content);
console.log('Done!');
