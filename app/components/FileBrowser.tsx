import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { SDCardAPI, FileEntry } from "../services/sdcard";

interface FileBrowserProps {
  ipAddress: string;
}

interface DownloadedImage {
  path: string;
  localUri: string;
  name: string;
}

interface DownloadProgress {
  path: string;
  progress: number; // 0 to 1
  totalBytes: number;
  downloadedBytes: number;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({ ipAddress }) => {
  const { colors } = useTheme();
  const [api] = useState(() => new SDCardAPI(ipAddress));
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map());
  const [downloadedImages, setDownloadedImages] = useState<DownloadedImage[]>([]);
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    try {
      const entries = await api.listDirectory(path);
      setFiles(entries);
      setCurrentPath(path);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load directory";
      Alert.alert("Error", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory(currentPath);
  }, []);

  const handleEntryPress = async (entry: FileEntry) => {
    if (entry.type === "dir") {
      // Navigate into directory
      setPathHistory([...pathHistory, currentPath]);
      loadDirectory(entry.path);
    } else {
      // Check if already downloaded
      const existing = downloadedImages.find(img => img.path === entry.path);
      if (existing) {
        // Already downloaded, nothing to do
        return;
      }

      // Check if already downloading
      if (downloadProgress.has(entry.path)) {
        // Download in progress, don't start another
        return;
      }

      // Initialize download progress
      setDownloadProgress(prev => {
        const newMap = new Map(prev);
        newMap.set(entry.path, {
          path: entry.path,
          progress: 0,
          totalBytes: entry.size,
          downloadedBytes: 0,
        });
        return newMap;
      });

      // Download and display file (assume it's an image)
      try {
        const localUri = await api.downloadFileToLocal(
          entry.path,
          entry.size,
          (progress, totalBytes, downloadedBytes) => {
            setDownloadProgress(prev => {
              const newMap = new Map(prev);
              newMap.set(entry.path, {
                path: entry.path,
                progress,
                totalBytes,
                downloadedBytes,
              });
              return newMap;
            });
          },
          65536 // 64KB chunks
        );

        // Only clear progress and show image after download is 100% complete
        // Wait a brief moment to ensure final progress update is rendered
        setTimeout(() => {
          // Clear progress
          setDownloadProgress(prev => {
            const newMap = new Map(prev);
            newMap.delete(entry.path);
            return newMap;
          });

          // Add to downloaded images
          setDownloadedImages(prev => [...prev, {
            path: entry.path,
            localUri,
            name: entry.name,
          }]);
        }, 100);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to download file";
        Alert.alert("Download Error", errorMessage);

        // Clear progress on error
        setDownloadProgress(prev => {
          const newMap = new Map(prev);
          newMap.delete(entry.path);
          return newMap;
        });
      }
    }
  };

  const handleBackPress = () => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory(pathHistory.slice(0, -1));
      loadDirectory(previousPath);
    }
  };

  const createStyles = () =>
    StyleSheet.create({
      container: {
        flex: 1,
      },
      header: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        backgroundColor: colors.cardBackground,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      backButton: {
        padding: 8,
        marginRight: 8,
      },
      backButtonText: {
        fontSize: 18,
        color: colors.accent,
        fontWeight: "600",
      },
      pathText: {
        flex: 1,
        fontSize: 14,
        color: colors.text,
        fontFamily: "monospace",
      },
      listContainer: {
        flex: 1,
      },
      fileEntry: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      fileIcon: {
        width: 40,
        alignItems: "center",
        marginRight: 12,
      },
      fileIconText: {
        fontSize: 24,
      },
      fileInfo: {
        flex: 1,
      },
      fileName: {
        fontSize: 16,
        color: colors.text,
        marginBottom: 4,
      },
      fileSize: {
        fontSize: 12,
        color: colors.textSecondary,
      },
      loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      },
      loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: colors.textSecondary,
      },
      emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      },
      emptyText: {
        fontSize: 16,
        color: colors.textSecondary,
      },
      downloadedImage: {
        width: "100%",
        aspectRatio: 4 / 3,
        borderRadius: 8,
        marginTop: 8,
        backgroundColor: colors.background,
      },
      progressBar: {
        height: 4,
        backgroundColor: colors.border,
        borderRadius: 2,
        marginTop: 8,
        overflow: "hidden",
      },
      progressFill: {
        height: "100%",
        backgroundColor: colors.accent,
      },
      progressText: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 4,
      },
    });

  const styles = createStyles();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "-";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  const renderFileEntry = ({ item }: { item: FileEntry }) => {
    const progress = downloadProgress.get(item.path);
    const downloadedImage = downloadedImages.find(img => img.path === item.path);
    const isDownloading = !!progress;

    return (
      <View>
        <TouchableOpacity
          style={styles.fileEntry}
          onPress={() => handleEntryPress(item)}
          disabled={isDownloading}
        >
          <View style={styles.fileIcon}>
            {isDownloading ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={styles.fileIconText}>{item.type === "dir" ? "📁" : "🖼️"}</Text>
            )}
          </View>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName}>{item.name}</Text>
            <Text style={styles.fileSize}>
              {item.type === "dir" ? "Directory" : formatFileSize(item.size)}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Show download progress */}
        {progress && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress.progress * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {formatFileSize(progress.downloadedBytes)} / {formatFileSize(progress.totalBytes)} ({Math.round(progress.progress * 100)}%)
            </Text>
          </View>
        )}

        {/* Show downloaded image inline */}
        {downloadedImage && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <Image
              source={{ uri: downloadedImage.localUri }}
              style={styles.downloadedImage}
              resizeMode="cover"
            />
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading directory...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {pathHistory.length > 0 && (
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.pathText}>{currentPath}</Text>
      </View>

      {files.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No files or directories found</Text>
        </View>
      ) : (
        <FlatList
          style={styles.listContainer}
          data={files}
          keyExtractor={(item) => item.path}
          renderItem={renderFileEntry}
        />
      )}
    </View>
  );
};
