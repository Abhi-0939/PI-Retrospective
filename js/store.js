/**
 * store.js — Data persistence and state management
 * PI Retrospective App — SAFe 6.0
 *
 * All retrospective data is stored in localStorage under two keys:
 *   'pi-retro-active'  — the retrospective currently being edited
 *   'pi-retro-history' — array of completed/saved retrospectives
 *
 * Sensitive credentials (Polarion tokens) are SESSION-ONLY and
 * never written to localStorage.
 */

'use strict';

/* ─── UUID Generator ─────────────────────────────────────────── */
const UUID = {
  /** Generate a RFC-4122-compliant UUID v4 without external libs */
  v4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
  /** Short 8-char ID for display purposes */
  short() {
    return UUID.v4().split('-')[0].toUpperCase();
  }
};

/* ─── Data Schema Factories ──────────────────────────────────── */
const Schema = {
  newRetrospective(piName, hostName) {
    return {
      id: UUID.v4(),
      piName: piName || 'Untitled PI',
      artName: '',
      teamName: '',
      startDate: '',
      endDate: '',
      piObjectives: '',
      sessionMode: 'synchronous',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'in-progress', // 'in-progress' | 'completed'

      host: Schema.newParticipant(hostName || 'Host', true),
      participants: [],
      participantsFinal: false,

      piContext: {
        events: [],
        milestones: [],
        specialOccurrences: []
      },

      board: {
        wentWell: [],
        couldImprove: [],
        didntGoWell: []
      },

      actionItems: []
    };
  },

  newParticipant(name, isHost = false) {
    const id = UUID.v4();
    const shortId = UUID.short();
    return {
      id,
      shortId,
      name: name || 'Anonymous',
      isHost,
      email: '',
      color: Schema._participantColor(id),
      joinedAt: new Date().toISOString()
    };
  },

  newEvent(text, date, authorId) {
    return {
      id: UUID.v4(),
      text: text || '',
      date: date || '',
      authorId: authorId || '',
      createdAt: new Date().toISOString()
    };
  },

  newMilestone(text, date, status, authorId) {
    return {
      id: UUID.v4(),
      text: text || '',
      date: date || '',
      status: status || 'achieved', // 'achieved' | 'partial' | 'missed'
      authorId: authorId || '',
      createdAt: new Date().toISOString()
    };
  },

  newSpecialOccurrence(text, category, authorId) {
    return {
      id: UUID.v4(),
      text: text || '',
      category: category || 'other',
      authorId: authorId || '',
      createdAt: new Date().toISOString()
    };
  },

  newNote(text, authorId, tags) {
    return {
      id: UUID.v4(),
      text: text || '',
      authorId: authorId || '',
      tags: tags || [],
      votes: 0,
      votedBy: [],
      createdAt: new Date().toISOString()
    };
  },

  newActionItem(opts = {}) {
    return {
      id: UUID.v4(),
      title: opts.title || '',
      description: opts.description || '',
      assigneeId: opts.assigneeId || '',
      priority: opts.priority || 'medium', // 'low' | 'medium' | 'high' | 'critical'
      dueDate: opts.dueDate || '',
      status: opts.status || 'open',       // 'open' | 'in-progress' | 'done'
      source: opts.source || 'manual',     // 'manual' | 'ai'
      linkedItemIds: opts.linkedItemIds || [],
      createdAt: new Date().toISOString()
    };
  },

  /** Deterministic color based on participant UUID */
  _participantColor(id) {
    const palette = [
      '#0052CC', '#00875A', '#FF5630', '#6554C0', '#00B8D9',
      '#FF8B00', '#36B37E', '#FF7452', '#2684FF', '#57D9A3',
      '#BF2600', '#403294', '#0065FF', '#ABF5D1', '#4C9AFF'
    ];
    // Simple hash from uuid chars
    const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return palette[hash % palette.length];
  }
};

/* ─── Store ──────────────────────────────────────────────────── */
const Store = {
  _COLLECTION: 'retrospectives',
  _ACTIVE_KEY: 'pi-retro-active',
  _HISTORY_KEY: 'pi-retro-history',
  _activeUnsubscribe: null,
  _historyUnsubscribe: null,

  // ─ Firebase Initialization Check ─────────────────────────────
  _ensureDB() {
    if (!window.db) {
      console.error('[Store] Firebase not initialized. Check firebase-config.js');
      throw new Error('Firebase Firestore not initialized');
    }
    return window.db;
  },

  // ─ Connection Monitoring ─────────────────────────────────────
  async setupConnectionMonitoring() {
    try {
      const db = this._ensureDB();
      const { enableNetwork, disableNetwork } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      // Monitor browser online/offline events
      window.addEventListener('online', () => {
        enableNetwork(db).catch(e => console.error('[Store] Failed to enable network:', e));
      });
      
      window.addEventListener('offline', () => {
        disableNetwork(db).catch(e => console.error('[Store] Failed to disable network:', e));
      });
    } catch (e) {
      console.warn('[Store] Could not setup connection monitoring (offline mode will still work):', e.message);
    }
  },

  // ─ Active Retrospective ──────────────────────────────────────
  async saveActive(retro) {
    try {
      const db = this._ensureDB();
      const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      // VALIDATION: Check structure BEFORE copying
      if (!retro) throw new Error('Retro object is null/undefined');
      if (!retro.piContext) {
        retro.piContext = { events: [], milestones: [], specialOccurrences: [] };
      }
      if (!retro.actionItems) {
        retro.actionItems = [];
      }
      
      // Create a deep copy
      const copy = JSON.parse(JSON.stringify(retro));
      copy.updatedAt = new Date().toISOString();
      
      // VALIDATION: Try to serialize the whole object
      try {
        JSON.stringify(copy);
      } catch (e) {
        throw new Error('Cannot serialize copy object to JSON: ' + e.message);
      }
      
      // Send to Firestore
      await setDoc(doc(db, this._COLLECTION, this._ACTIVE_KEY), copy);
      
    } catch (e) {
      console.error('[Store] Failed to save to Firestore:', e.message);
      console.warn('[Store] Falling back to localStorage');
      this._saveActiveLocal(retro);
    }
  },

  async loadActive() {
    try {
      const db = this._ensureDB();
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      const docSnap = await getDoc(doc(db, this._COLLECTION, this._ACTIVE_KEY));
      return docSnap.exists() ? docSnap.data() : null;
    } catch (e) {
      console.warn('[Store] Firestore load failed, falling back to localStorage:', e);
      return this._loadActiveLocal();
    }
  },

  async subscribeToActive(callback) {
    try {
      const db = this._ensureDB();
      const { onSnapshot, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      // Unsubscribe from previous listener if any
      if (this._activeUnsubscribe) {
        this._activeUnsubscribe();
      }

      // Real-time listener for active retrospective
      this._activeUnsubscribe = onSnapshot(
        doc(db, this._COLLECTION, this._ACTIVE_KEY),
        (snapshot) => {
          const data = snapshot.exists() ? snapshot.data() : null;
          if (callback && typeof callback === 'function') {
            callback(data);
          }
        },
        (error) => {
          console.error('[Store] Real-time listener error:', error);
        }
      );
    } catch (e) {
      console.error('[Store] Failed to subscribe to active retro:', e);
    }
  },

  async clearActive() {
    try {
      const db = this._ensureDB();
      const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      await deleteDoc(doc(db, this._COLLECTION, this._ACTIVE_KEY));
      console.log('[Store] Active retrospective cleared from Firestore');
    } catch (e) {
      // Fallback to localStorage if Firestore fails
      console.warn('[Store] Firestore delete failed, falling back to localStorage:', e);
      this._clearActiveLocal();
    }
  },

  // ─ History ───────────────────────────────────────────────────
  async saveToHistory(retro) {
    try {
      const db = this._ensureDB();
      const { setDoc, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      const copy = JSON.parse(JSON.stringify(retro));
      copy.updatedAt = new Date().toISOString();
      copy.status = 'completed';

      // Save individual retro to 'history' top-level collection
      await setDoc(doc(db, 'history', copy.id), copy);
      
      console.log('[Store] Retrospective saved to history');
    } catch (e) {
      console.warn('[Store] Firestore history save failed, falling back to localStorage:', e);
      this._saveToHistoryLocal(retro);
    }
  },

  async loadHistory() {
    try {
      const db = this._ensureDB();
      const { query, collection, getDocs, orderBy, limit } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      const q = query(
        collection(db, 'history'),
        orderBy('updatedAt', 'desc'),
        limit(50)
      );
      
      const querySnapshot = await getDocs(q);
      const history = [];
      querySnapshot.forEach(doc => {
        history.push(doc.data());
      });
      
      return history;
    } catch (e) {
      console.warn('[Store] Firestore history load failed, falling back to localStorage:', e);
      return this._loadHistoryLocal();
    }
  },

  async deleteFromHistory(id) {
    try {
      const db = this._ensureDB();
      const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      await deleteDoc(doc(db, 'history', id));
      console.log('[Store] Retrospective deleted from history');
    } catch (e) {
      console.warn('[Store] Firestore delete failed, falling back to localStorage:', e);
      this._deleteFromHistoryLocal(id);
    }
  },

  async archiveInHistory(id) {
    try {
      const db = this._ensureDB();
      const { updateDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      await updateDoc(doc(db, 'history', id), {
        status: 'archived',
        archivedAt: new Date().toISOString()
      });
      console.log('[Store] Retrospective archived');
    } catch (e) {
      console.warn('[Store] Firestore archive failed, falling back to localStorage:', e);
      this._archiveInHistoryLocal(id);
    }
  },

  async clearHistory() {
    try {
      const db = this._ensureDB();
      const { collection, getDocs, deleteDoc, doc, query } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      
      const q = query(collection(db, 'history'));
      const querySnapshot = await getDocs(q);
      
      // Delete all documents in history collection
      const deletePromises = querySnapshot.docs.map(docSnap => 
        deleteDoc(doc(db, 'history', docSnap.id))
      );
      
      await Promise.all(deletePromises);
      console.log('[Store] History cleared from Firestore');
    } catch (e) {
      console.warn('[Store] Firestore clear history failed, falling back to localStorage:', e);
      this._clearHistoryLocal();
    }
  },

  // ─ Local Storage Fallbacks ──────────────────────────────────
  _saveActiveLocal(retro) {
    try {
      const copy = JSON.parse(JSON.stringify(retro));
      copy.updatedAt = new Date().toISOString();
      localStorage.setItem(this._ACTIVE_KEY, JSON.stringify(copy));
    } catch (e) {
      console.error('[Store] Failed to save active retro locally:', e);
    }
  },

  _loadActiveLocal() {
    try {
      const raw = localStorage.getItem(this._ACTIVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('[Store] Failed to load active retro locally:', e);
      return null;
    }
  },

  _clearActiveLocal() {
    localStorage.removeItem(this._ACTIVE_KEY);
  },

  _saveToHistoryLocal(retro) {
    try {
      const history = this._loadHistoryLocal();
      const copy = JSON.parse(JSON.stringify(retro));
      copy.updatedAt = new Date().toISOString();
      copy.status = 'completed';
      const idx = history.findIndex(h => h.id === copy.id);
      if (idx >= 0) {
        history[idx] = copy;
      } else {
        history.unshift(copy);
      }
      const trimmed = history.slice(0, 50);
      localStorage.setItem(this._HISTORY_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('[Store] Failed to save to history locally:', e);
    }
  },

  _loadHistoryLocal() {
    try {
      const raw = localStorage.getItem(this._HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('[Store] Failed to load history locally:', e);
      return [];
    }
  },

  _deleteFromHistoryLocal(id) {
    const history = this._loadHistoryLocal();
    const filtered = history.filter(h => h.id !== id);
    localStorage.setItem(this._HISTORY_KEY, JSON.stringify(filtered));
  },

  _archiveInHistoryLocal(id) {
    try {
      const history = this._loadHistoryLocal();
      const idx = history.findIndex(h => h.id === id);
      if (idx < 0) return;
      history[idx] = {
        ...history[idx],
        status: 'archived',
        archivedAt: new Date().toISOString()
      };
      localStorage.setItem(this._HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('[Store] Failed to archive retro locally:', e);
    }
  },

  _clearHistoryLocal() {
    localStorage.removeItem(this._HISTORY_KEY);
  },

  // ─ Utilities ─────────────────────────────────────────────────
  exportJSON(retro) {
    const data = JSON.stringify(retro, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `PI-Retro-${(retro.piName || 'export').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
