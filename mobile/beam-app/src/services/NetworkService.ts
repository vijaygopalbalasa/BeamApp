/**
 * NetworkService - Monitors network connectivity changes
 *
 * Detects transitions between offline and online states
 * Triggers callbacks when connectivity is restored
 */

import NetInfo from '@react-native-community/netinfo';

type NetworkListener = (isOnline: boolean) => void;

class NetworkService {
  private listeners = new Set<NetworkListener>();
  private isOnline = false;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.startMonitoring();
  }

  private startMonitoring(): void {
    // Subscribe to network state changes
    this.unsubscribe = NetInfo.addEventListener(state => {
      const wasOnline = this.isOnline;
      this.isOnline = state.isConnected === true && state.isInternetReachable === true;

      console.log('[NetworkService] Network state changed:', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        wasOnline,
        isOnline: this.isOnline,
        type: state.type,
      });

      // Only notify on offline → online transition
      if (!wasOnline && this.isOnline) {
        console.log('[NetworkService] ✅ ONLINE - Internet connectivity restored!');
        this.notifyListeners(true);
      } else if (wasOnline && !this.isOnline) {
        console.log('[NetworkService] ❌ OFFLINE - Internet connectivity lost');
        this.notifyListeners(false);
      }
    });

    // Get initial state
    NetInfo.fetch().then(state => {
      this.isOnline = state.isConnected === true && state.isInternetReachable === true;
      console.log('[NetworkService] Initial network state:', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        isOnline: this.isOnline,
        type: state.type,
      });
    });
  }

  /**
   * Add a listener that will be called when network status changes
   * Returns an unsubscribe function
   */
  addOnlineListener(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.isOnline);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check if currently online
   */
  getIsOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Force refresh network state
   */
  async refresh(): Promise<boolean> {
    const state = await NetInfo.fetch();
    const wasOnline = this.isOnline;
    this.isOnline = state.isConnected === true && state.isInternetReachable === true;

    if (wasOnline !== this.isOnline) {
      this.notifyListeners(this.isOnline);
    }

    return this.isOnline;
  }

  private notifyListeners(isOnline: boolean): void {
    this.listeners.forEach(listener => {
      try {
        listener(isOnline);
      } catch (err) {
        console.error('[NetworkService] Listener error:', err);
      }
    });
  }

  /**
   * Stop monitoring (cleanup)
   */
  destroy(): void {
    this.unsubscribe?.();
    this.listeners.clear();
  }
}

// Singleton instance
export const networkService = new NetworkService();
