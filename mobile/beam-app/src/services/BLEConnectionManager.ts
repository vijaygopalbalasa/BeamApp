/**
 * BLE Connection Manager
 *
 * Manages BLE connection state and provides connection confirmation
 * for both customer (central) and merchant (peripheral) roles.
 *
 * Features:
 * - Connection state tracking
 * - Peer discovery and validation
 * - Connection confirmation callbacks
 * - Timeout handling
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

export interface BLEConnectionState {
  isConnected: boolean;
  peerAddress: string | null;
  peerName: string | null;
  connectionTime: number | null;
  role: 'customer' | 'merchant' | null;
}

export interface BLEConnectionEvent {
  type: 'connected' | 'disconnected' | 'connection_failed';
  peerAddress: string;
  peerName?: string;
  timestamp: number;
}

type ConnectionListener = (event: BLEConnectionEvent) => void;

class BLEConnectionManager {
  private connectionState: BLEConnectionState = {
    isConnected: false,
    peerAddress: null,
    peerName: null,
    connectionTime: null,
    role: null,
  };

  private connectionListeners = new Set<ConnectionListener>();
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    // Setup native event emitter if available
    const MeshNetworkBridge = NativeModules.MeshNetworkBridge;
    if (MeshNetworkBridge) {
      this.eventEmitter = new NativeEventEmitter(MeshNetworkBridge);

      // Listen to native connection events (MUST MATCH MeshNetworkBridge.kt event names!)
      // Native Kotlin emits: 'PeerConnected' and 'PeerDisconnected'
      this.eventEmitter.addListener('PeerConnected', this.handlePeerConnected);
      this.eventEmitter.addListener('PeerDisconnected', this.handlePeerDisconnected);
    }
  }

  private handlePeerConnected = (event: any) => {
    console.log('[BLEConnectionManager] Peer connected:', event);

    this.connectionState = {
      isConnected: true,
      peerAddress: event.address || event.deviceAddress || 'unknown',
      peerName: event.name || event.deviceName || 'Unknown Device',
      connectionTime: Date.now(),
      role: this.connectionState.role,
    };

    const connectionEvent: BLEConnectionEvent = {
      type: 'connected',
      peerAddress: this.connectionState.peerAddress!,
      peerName: this.connectionState.peerName!,
      timestamp: Date.now(),
    };

    this.notifyListeners(connectionEvent);
  };

  private handlePeerDisconnected = (event: any) => {
    console.log('[BLEConnectionManager] Peer disconnected:', event);

    const peerAddress = this.connectionState.peerAddress || event.address || 'unknown';

    this.connectionState = {
      isConnected: false,
      peerAddress: null,
      peerName: null,
      connectionTime: null,
      role: this.connectionState.role,
    };

    const connectionEvent: BLEConnectionEvent = {
      type: 'disconnected',
      peerAddress,
      timestamp: Date.now(),
    };

    this.notifyListeners(connectionEvent);
  };

  private notifyListeners(event: BLEConnectionEvent) {
    this.connectionListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        console.error('[BLEConnectionManager] Listener error:', err);
      }
    });
  }

  /**
   * Set the current role (customer or merchant)
   */
  setRole(role: 'customer' | 'merchant') {
    this.connectionState.role = role;
    console.log('[BLEConnectionManager] Role set to:', role);
  }

  /**
   * Get current connection state
   */
  getConnectionState(): BLEConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connectionState.isConnected;
  }

  /**
   * Wait for connection with timeout
   * Returns true if connected within timeout, false otherwise
   */
  async waitForConnection(timeoutMs: number = 30000): Promise<boolean> {
    // Already connected
    if (this.connectionState.isConnected) {
      console.log('[BLEConnectionManager] Already connected');
      return true;
    }

    console.log(`[BLEConnectionManager] Waiting for connection (timeout: ${timeoutMs}ms)...`);

    return new Promise((resolve) => {
      let resolved = false;

      const listener: ConnectionListener = (event) => {
        if (event.type === 'connected' && !resolved) {
          resolved = true;
          this.removeConnectionListener(listener);
          clearTimeout(timeoutHandle);
          console.log('[BLEConnectionManager] Connection established!');
          resolve(true);
        }
      };

      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.removeConnectionListener(listener);
          console.log('[BLEConnectionManager] Connection timeout');
          resolve(false);
        }
      }, timeoutMs);

      this.addConnectionListener(listener);
    });
  }

  /**
   * Add connection state listener
   */
  addConnectionListener(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.removeConnectionListener(listener);
  }

  /**
   * Remove connection state listener
   */
  removeConnectionListener(listener: ConnectionListener) {
    this.connectionListeners.delete(listener);
  }

  /**
   * Manually update connection state (for testing or external updates)
   */
  updateConnectionState(state: Partial<BLEConnectionState>) {
    this.connectionState = {
      ...this.connectionState,
      ...state,
    };

    if (state.isConnected !== undefined) {
      const event: BLEConnectionEvent = {
        type: state.isConnected ? 'connected' : 'disconnected',
        peerAddress: this.connectionState.peerAddress || 'manual',
        peerName: this.connectionState.peerName,
        timestamp: Date.now(),
      };
      this.notifyListeners(event);
    }
  }

  /**
   * Reset connection state
   */
  reset() {
    this.connectionState = {
      isConnected: false,
      peerAddress: null,
      peerName: null,
      connectionTime: null,
      role: null,
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    this.connectionListeners.clear();
    this.eventEmitter?.removeAllListeners('PeerConnected');
    this.eventEmitter?.removeAllListeners('PeerDisconnected');
  }
}

// Singleton instance
export const bleConnectionManager = new BLEConnectionManager();
