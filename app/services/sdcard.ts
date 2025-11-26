import * as FileSystem from 'expo-file-system';
import { logger } from './logger';

export interface FileEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  size: number;
}

export class SDCardAPI {
  private baseUrl: string;

  constructor(ipAddress: string) {
    this.baseUrl = `http://${ipAddress}`;
    logger.info(`SD Card API initialized with IP: ${ipAddress}`);
  }

  /**
   * List files and directories in a given path
   * @param dir Directory path (e.g., "/", "/DCIM")
   */
  async listDirectory(dir: string): Promise<FileEntry[]> {
    const url = `${this.baseUrl}/ls?dir=${encodeURIComponent(dir)}`;
    logger.info(`Listing directory: ${dir}`);

    try {
      const startTime = Date.now();
      const response = await fetch(url);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`List directory failed (${response.status}): ${errorText}`);
        throw new Error(`Failed to list directory: ${errorText}`);
      }

      const data: FileEntry[] = await response.json();
      logger.success(`Found ${data.length} items in ${dir} (${duration}ms)`);

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Error listing directory: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Download a single chunk without retry
   * @param url Chunk download URL
   * @param chunkNumber Chunk number (for logging)
   * @returns ArrayBuffer containing chunk data, or null if failed
   */
  private async downloadChunk(
    url: string,
    chunkNumber: number
  ): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const chunkData = await response.arrayBuffer();
      return chunkData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Chunk ${chunkNumber} failed: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Download a file from SD card and save to local device storage with progress tracking
   * Uses chunked download API with queue-based retry (failed chunks go to back of queue)
   * @param path Full path to the file (e.g., "/DCIM/photo.jpg")
   * @param fileSize Total file size in bytes (from ls endpoint)
   * @param onProgress Callback for progress updates (0 to 1)
   * @param chunkSize Size of each chunk in bytes (default: 8192, range: 1024-32768)
   * @param maxRetries Maximum retry attempts per chunk (default: 3)
   * @returns Object containing base64Data and localUri
   */
  async downloadFileToLocal(
    path: string,
    fileSize: number,
    onProgress?: (progress: number, totalBytes: number, downloadedBytes: number) => void,
    chunkSize: number = 8192,
    maxRetries: number = 3
  ): Promise<{ base64Data: string; localUri: string }> {
    const filename = path.split('/').pop() || 'download';
    const localUri = `${FileSystem.cacheDirectory}${filename}`;

    logger.info(`Downloading file: ${filename}`);
    logger.info(`File size: ${fileSize} bytes, chunk size: ${chunkSize} bytes`);

    try {
      const startTime = Date.now();

      // Calculate total chunks
      const totalChunks = Math.ceil(fileSize / chunkSize);
      logger.info(`Downloading in ${totalChunks} chunks (max ${maxRetries} retries per chunk)`);

      // Delete existing file if it exists
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(localUri);
      }

      // Track downloaded chunks
      const chunks: Map<number, ArrayBuffer> = new Map();
      const downloadQueue: Array<{ chunkNumber: number; attempt: number }> = [];

      // Initialize queue with all chunks
      for (let i = 0; i < totalChunks; i++) {
        downloadQueue.push({ chunkNumber: i, attempt: 0 });
      }

      // Process download queue
      while (downloadQueue.length > 0) {
        const item = downloadQueue.shift()!;
        const { chunkNumber, attempt } = item;

        const url = `${this.baseUrl}/cat?path=${encodeURIComponent(path)}&chunk=${chunkNumber}&size=${chunkSize}`;

        if (attempt > 0) {
          logger.info(`Retrying chunk ${chunkNumber} (attempt ${attempt + 1}/${maxRetries + 1})`);
        } else {
          logger.data(`Downloading chunk ${chunkNumber + 1}/${totalChunks}`);
        }

        // Try to download chunk
        const chunkData = await this.downloadChunk(url, chunkNumber);

        if (chunkData) {
          // Success - store chunk
          chunks.set(chunkNumber, chunkData);

          if (attempt > 0) {
            logger.success(`Chunk ${chunkNumber} succeeded on attempt ${attempt + 1}`);
          }

          // Update progress
          const totalDownloaded = Array.from(chunks.values()).reduce((sum, chunk) => sum + chunk.byteLength, 0);
          const progress = totalDownloaded / fileSize;
          logger.data(`Progress: ${totalDownloaded} / ${fileSize} bytes (${Math.round(progress * 100)}%)`);

          if (onProgress) {
            onProgress(progress, fileSize, totalDownloaded);
          }
        } else {
          // Failed - add to back of queue if retries remain
          if (attempt < maxRetries) {
            downloadQueue.push({ chunkNumber, attempt: attempt + 1 });
            logger.info(`Chunk ${chunkNumber} added to back of queue (${downloadQueue.length} chunks remaining)`);
          } else {
            // Max retries exceeded
            throw new Error(`Chunk ${chunkNumber} failed after ${maxRetries + 1} attempts`);
          }
        }
      }

      // All chunks downloaded - assemble file in order
      logger.info(`All chunks downloaded, assembling file...`);

      // Calculate total size
      let totalSize = 0;
      for (let chunkNumber = 0; chunkNumber < totalChunks; chunkNumber++) {
        const chunkData = chunks.get(chunkNumber);
        if (!chunkData) {
          throw new Error(`Missing chunk ${chunkNumber}`);
        }
        totalSize += chunkData.byteLength;
      }

      logger.data(`Total file size: ${totalSize} bytes`);

      // Combine all chunks in order into a single Uint8Array (binary first!)
      const combined = new Uint8Array(totalSize);
      let offset = 0;

      for (let chunkNumber = 0; chunkNumber < totalChunks; chunkNumber++) {
        const chunkData = chunks.get(chunkNumber);
        if (!chunkData) {
          throw new Error(`Missing chunk ${chunkNumber}`);
        }

        // Copy chunk data into combined array at correct offset
        combined.set(new Uint8Array(chunkData), offset);
        offset += chunkData.byteLength;

        logger.data(`Assembled chunk ${chunkNumber + 1}/${totalChunks} at offset ${offset - chunkData.byteLength}`);
      }

      // Now convert the complete binary data to base64 ONCE
      const base64Data = btoa(
        Array.from(combined).map(byte => String.fromCharCode(byte)).join('')
      );

      logger.success(`Combined ${totalChunks} chunks into ${totalSize} bytes, base64 length: ${base64Data.length}`);

      // Write the complete file once
      await FileSystem.writeAsStringAsync(localUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64
      });

      const duration = Date.now() - startTime;
      logger.success(`Downloaded ${filename} (${duration}ms)`);
      logger.data(`Saved to: ${localUri}`);

      return { base64Data, localUri };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Error downloading file: ${errorMessage}`);

      // Clean up partial file on error
      try {
        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(localUri);
        }
      } catch (cleanupError) {
        logger.error(`Failed to clean up partial file`);
      }

      throw error;
    }
  }

  /**
   * Delete a file or directory
   * @param path Path without leading "/" (e.g., "DCIM/photo.jpg")
   */
  async deleteFile(path: string): Promise<void> {
    try {
      // Remove leading "/" if present
      const cleanPath = path.startsWith("/") ? path.substring(1) : path;

      const response = await fetch(`${this.baseUrl}/rm?path=${encodeURIComponent(cleanPath)}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete file: ${errorText}`);
      }
    } catch (error) {
      console.error("Error deleting file:", error);
      throw error;
    }
  }

  /**
   * Get WiFi status
   */
  async getWifiStatus(): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/wifistatus`);
      const status = await response.text();
      return status;
    } catch (error) {
      console.error("Error getting WiFi status:", error);
      throw error;
    }
  }
}
