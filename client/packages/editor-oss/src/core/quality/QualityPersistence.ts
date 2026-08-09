import type { IQualitySettings, IQualityPreset } from './interfaces/IQualityManager';
import type { IDeviceCapabilities, IPerformanceHistoryEntry } from './types';

/**
 * Handles persistence of quality settings and custom presets
 */
export class QualityPersistence {
    private readonly STORAGE_KEY_SETTINGS = 'stemstudio_quality_settings';
    private readonly STORAGE_KEY_CUSTOM_PRESETS = 'stemstudio_quality_custom_presets';
    
    // IndexedDB for larger data
    private dbName = 'StemStudioQuality';
    private dbVersion = 1;
    private db: IDBDatabase | null = null;

    constructor() {
        this.initializeDB();
    }

    private async initializeDB(): Promise<void> {
        if (typeof indexedDB === "undefined") {
            return;
        }

        try {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('Failed to open IndexedDB for quality settings');
            };
            
            request.onsuccess = () => {
                this.db = request.result;
            };
            
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // Create object stores
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains('presets')) {
                    db.createObjectStore('presets', { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains('profiles')) {
                    const profileStore = db.createObjectStore('profiles', { keyPath: 'deviceId' });
                    profileStore.createIndex('lastUsed', 'lastUsed', { unique: false });
                }
            };
        } catch (error) {
            console.error('IndexedDB initialization failed:', error);
        }
    }

    public async saveSettings(settings: IQualitySettings): Promise<void> {
        // Try IndexedDB first
        if (this.db) {
            try {
                const transaction = this.db.transaction(['settings'], 'readwrite');
                const store = transaction.objectStore('settings');
                await this.promisifyRequest(store.put({ id: 'current', settings, timestamp: Date.now() }));
                return;
            } catch (error) {
                console.warn('IndexedDB save failed, falling back to localStorage:', error);
            }
        }
        
        // Fallback to localStorage
        try {
            localStorage.setItem(this.STORAGE_KEY_SETTINGS, JSON.stringify({
                settings,
                timestamp: Date.now(),
            }));
        } catch (error) {
            console.error('Failed to save quality settings:', error);
        }
    }

    public async loadSettings(): Promise<IQualitySettings | null> {
        // Try IndexedDB first
        if (this.db) {
            try {
                const transaction = this.db.transaction(['settings'], 'readonly');
                const store = transaction.objectStore('settings');
                const result = await this.promisifyRequest(store.get('current'));
                if (result && result.settings) {
                    return result.settings;
                }
            } catch (error) {
                console.warn('IndexedDB load failed, falling back to localStorage:', error);
            }
        }
        
        // Fallback to localStorage
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY_SETTINGS);
            if (stored) {
                const parsed = JSON.parse(stored);
                return parsed.settings;
            }
        } catch (error) {
            console.error('Failed to load quality settings:', error);
        }
        
        return null;
    }

    public async saveCustomPresets(presets: IQualityPreset[]): Promise<void> {
        // Try IndexedDB first
        if (this.db) {
            try {
                const transaction = this.db.transaction(['presets'], 'readwrite');
                const store = transaction.objectStore('presets');
                
                // Clear existing and add new
                await this.promisifyRequest(store.clear());
                for (const preset of presets) {
                    await this.promisifyRequest(store.add(preset));
                }
                return;
            } catch (error) {
                console.warn('IndexedDB preset save failed, falling back to localStorage:', error);
            }
        }
        
        // Fallback to localStorage
        try {
            localStorage.setItem(this.STORAGE_KEY_CUSTOM_PRESETS, JSON.stringify(presets));
        } catch (error) {
            console.error('Failed to save custom presets:', error);
        }
    }

    public async loadCustomPresets(): Promise<IQualityPreset[]> {
        // Try IndexedDB first
        if (this.db) {
            try {
                const transaction = this.db.transaction(['presets'], 'readonly');
                const store = transaction.objectStore('presets');
                const results = await this.promisifyRequest(store.getAll());
                if (results && results.length > 0) {
                    return results;
                }
            } catch (error) {
                console.warn('IndexedDB preset load failed, falling back to localStorage:', error);
            }
        }
        
        // Fallback to localStorage
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY_CUSTOM_PRESETS);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('Failed to load custom presets:', error);
        }
        
        return [];
    }

    public async saveDeviceProfile(profile: {
        deviceId: string;
        capabilities: IDeviceCapabilities;
        recommendedSettings: IQualitySettings;
        performanceHistory: IPerformanceHistoryEntry[];
    }): Promise<void> {
        if (!this.db) return;
        
        try {
            const transaction = this.db.transaction(['profiles'], 'readwrite');
            const store = transaction.objectStore('profiles');
            await this.promisifyRequest(store.put({
                ...profile,
                lastUsed: Date.now(),
            }));
        } catch (error) {
            console.error('Failed to save device profile:', error);
        }
    }

    public async loadDeviceProfile(deviceId: string): Promise<{
        deviceId: string;
        capabilities: IDeviceCapabilities;
        recommendedSettings: IQualitySettings;
        performanceHistory: IPerformanceHistoryEntry[];
        lastUsed: number;
    } | null> {
        if (!this.db) return null;
        
        try {
            const transaction = this.db.transaction(['profiles'], 'readonly');
            const store = transaction.objectStore('profiles');
            return await this.promisifyRequest(store.get(deviceId));
        } catch (error) {
            console.error('Failed to load device profile:', error);
            return null;
        }
    }

    public async clearOldProfiles(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
        if (!this.db) return;
        
        try {
            const transaction = this.db.transaction(['profiles'], 'readwrite');
            const store = transaction.objectStore('profiles');
            const index = store.index('lastUsed');
            const cutoffTime = Date.now() - maxAge;
            
            const range = IDBKeyRange.upperBound(cutoffTime);
            const request = index.openCursor(range);
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
        } catch (error) {
            console.error('Failed to clear old profiles:', error);
        }
    }

    private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    public exportSettings(): string {
        const data = {
            settings: this.loadSettings(),
            customPresets: this.loadCustomPresets(),
            version: 1,
            timestamp: Date.now(),
        };
        
        return JSON.stringify(data, null, 2);
    }

    public async importSettings(jsonData: string): Promise<void> {
        try {
            const data = JSON.parse(jsonData);
            
            if (data.settings) {
                await this.saveSettings(data.settings);
            }
            
            if (data.customPresets) {
                await this.saveCustomPresets(data.customPresets);
            }
        } catch (error) {
            console.error('Failed to import settings:', error);
            throw new Error('Invalid settings data');
        }
    }
}
