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
   * Download a file from SD card and save to local device storage with progress tracking
   * @param path Full path to the file (e.g., "/DCIM/photo.jpg")
   * @param onProgress Callback for progress updates (0 to 1)
   * @returns Local file URI on the device
   */
  async downloadFileToLocal(
    path: string,
    onProgress?: (progress: number, totalBytes: number, downloadedBytes: number) => void
  ): Promise<string> {
    const url = `${this.baseUrl}/cat?path=${encodeURIComponent(path)}`;
    const filename = path.split('/').pop() || 'download';
    const localUri = `${FileSystem.cacheDirectory}${filename}`;

    logger.info(`Downloading file: ${filename}`);
    logger.info(`Download URL: ${url}`);

    try {
      const startTime = Date.now();

      // Create download with progress callback
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        localUri,
        {},
        (downloadProgress) => {
          logger.data(`Download progress: ${downloadProgress.totalBytesWritten} / ${downloadProgress.totalBytesExpectedToWrite}`);

          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;

          // Check if we have valid progress data
          if (!isNaN(progress) && isFinite(progress)) {
            if (onProgress) {
              onProgress(
                progress,
                downloadProgress.totalBytesExpectedToWrite,
                downloadProgress.totalBytesWritten
              );
            }
          } else {
            logger.info(`Progress unavailable - server may not be sending Content-Length header`);
          }
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();
      const duration = Date.now() - startTime;

      if (!downloadResult) {
        logger.error(`Download failed - no result returned`);
        throw new Error(`Download failed`);
      }

      if (downloadResult.status !== 200) {
        logger.error(`Download failed with status: ${downloadResult.status}`);
        throw new Error(`Download failed with status: ${downloadResult.status}`);
      }

      logger.success(`Downloaded ${filename} (${duration}ms)`);
      logger.data(`Saved to: ${localUri}`);

      return downloadResult.uri;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Error downloading file: ${errorMessage}`);
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
