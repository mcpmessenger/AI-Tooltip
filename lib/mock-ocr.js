// lib/mock-ocr.js - Mock implementation for Paddle.js/WASM OCR

/**
 * Simulates the client-side OCR process using an image URL.
 * In a real implementation, this would use a library like Paddle.js
 * to fetch the image, process it on a canvas, and run the WASM model.
 * @param {string} imageUrl - The URL of the image to process.
 * @returns {Promise<string>} - A promise that resolves with the recognized text.
 */
async function runClientSideOCR(imageUrl) {
  console.log(`[Mock OCR] Starting OCR for image: ${imageUrl}`);

  // Simulate the time taken for image download, canvas processing, and WASM execution
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Mock logic to return different results based on the image URL (if possible)
  let recognizedText = `Text recognized from image at ${imageUrl}: "The image contains a paperclip mascot with a speech bubble, ready to assist the user."`;

  if (imageUrl.includes('chart')) {
    recognizedText =
      'OCR Result: "Quarterly Sales Report: Q1: $1.2M, Q2: $1.5M, Q3: $1.8M, Q4: $2.1M. Growth is steady."';
  } else if (imageUrl.includes('code')) {
    recognizedText = 'OCR Result: "function helloWorld() { console.log(\'Hello, World!\'); }"';
  }

  console.log(`[Mock OCR] Finished OCR. Result: ${recognizedText}`);
  return recognizedText;
}
