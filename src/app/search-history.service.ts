import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface SearchHistoryItem {
  query: string;
  timestamp: number;
  resultCount: number;
  searchType?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SearchHistoryService {
  private readonly STORAGE_KEY = 'searchHistory';
  private readonly MAX_HISTORY_ITEMS = 30;
  private historySubject = new BehaviorSubject<SearchHistoryItem[]>([]);

  constructor() {
    this.loadHistory();
  }

  /**
   * Load search history from localStorage
   */
  private loadHistory(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const history = JSON.parse(stored) as SearchHistoryItem[];
        // Sort by timestamp (newest first)
        history.sort((a, b) => b.timestamp - a.timestamp);
        this.historySubject.next(history);
      }
    } catch (error) {
      console.error('Error loading search history:', error);
      this.historySubject.next([]);
    }
  }

  /**
   * Save search history to localStorage
   */
  private saveHistory(history: SearchHistoryItem[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
      this.historySubject.next(history);
    } catch (error) {
      // Error saving search history
    }
  }

  /**
   * Add a search to history
   */
  addSearch(query: string, resultCount: number, searchType?: string): void {
    if (!query || !query.trim()) {
      return;
    }

    const trimmedQuery = query.trim();
    const currentHistory = this.historySubject.value;
    
    // Remove duplicate entries (same query)
    const filteredHistory = currentHistory.filter(item => item.query !== trimmedQuery);
    
    // Create new history item
    const newItem: SearchHistoryItem = {
      query: trimmedQuery,
      timestamp: Date.now(),
      resultCount,
      searchType
    };

    // Add to beginning and limit size
    const updatedHistory = [newItem, ...filteredHistory].slice(0, this.MAX_HISTORY_ITEMS);
    this.saveHistory(updatedHistory);
  }

  /**
   * Get search history as observable
   */
  getHistory$(): Observable<SearchHistoryItem[]> {
    return this.historySubject.asObservable();
  }

  /**
   * Get search history synchronously
   */
  getHistory(): SearchHistoryItem[] {
    return this.historySubject.value;
  }

  /**
   * Get recent searches (last N items)
   */
  getRecentSearches(limit: number = 10): SearchHistoryItem[] {
    return this.historySubject.value.slice(0, limit);
  }

  /**
   * Clear all search history
   */
  clearHistory(): void {
    this.saveHistory([]);
  }

  /**
   * Remove a specific search from history
   */
  removeSearch(query: string): void {
    const currentHistory = this.historySubject.value;
    const filteredHistory = currentHistory.filter(item => item.query !== query);
    this.saveHistory(filteredHistory);
  }

  /**
   * Group history by date
   */
  getGroupedHistory(): { label: string; items: SearchHistoryItem[] }[] {
    const history = this.historySubject.value;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;

    const groups: { label: string; items: SearchHistoryItem[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'This Week', items: [] },
      { label: 'Older', items: [] }
    ];

    history.forEach(item => {
      const age = now - item.timestamp;
      if (age < oneDay) {
        groups[0].items.push(item);
      } else if (age < 2 * oneDay) {
        groups[1].items.push(item);
      } else if (age < oneWeek) {
        groups[2].items.push(item);
      } else {
        groups[3].items.push(item);
      }
    });

    // Remove empty groups
    return groups.filter(group => group.items.length > 0);
  }
}


