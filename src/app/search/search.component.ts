import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DictionaryService, DictionaryEntry } from '../dictionary.service';
import { SearchService, SearchOptions } from '../search.service';
import { SettingsService } from '../settings.service';
import { SearchHistoryService, SearchHistoryItem } from '../search-history.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit {
  searchQuery = '';
  searchResults: DictionaryEntry[] = [];
  suggestions: string[] = [];
  isLoading = false;
  showSuggestions = false;
  showAdvancedFilters = false;
  showHistory = false;
  searchHistory: SearchHistoryItem[] = [];
  groupedHistory: { label: string; items: SearchHistoryItem[] }[] = [];
  
  // Advanced filter options
  searchType: 'auto' | 'chinese' | 'pinyin' | 'english' = 'auto';
  matchWholeWord = false;
  matchStart = false;
  matchEnd = false;
  
  // Settings
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  constructor(
    private searchService: SearchService,
    private dictionaryService: DictionaryService,
    private settingsService: SettingsService,
    private router: Router,
    private searchHistoryService: SearchHistoryService
  ) {}

  ngOnInit() {
    this.fontSize = this.settingsService.getFontSize();
    this.showSimplified = this.settingsService.getShowSimplified();
    
    this.settingsService.getFontSize$().subscribe(size => {
      this.fontSize = size;
    });
    
    this.settingsService.getShowSimplified$().subscribe(show => {
      this.showSimplified = show;
    });

    // Load search history
    this.searchHistoryService.getHistory$().subscribe(history => {
      this.searchHistory = history;
      this.groupedHistory = this.searchHistoryService.getGroupedHistory();
    });
  }

  onSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    
    if (value.length > 0) {
      this.getSuggestions(value);
      this.showSuggestions = true;
      this.showHistory = false;
    } else {
      this.suggestions = [];
      this.showSuggestions = false;
      this.searchResults = [];
      // Show history when input is empty
      this.updateHistoryDisplay();
    }
  }

  onSearchFocus() {
    if (!this.searchQuery) {
      this.updateHistoryDisplay();
      this.showHistory = true;
    }
  }

  onSearchBlur() {
    // Delay hiding to allow clicks on history items
    setTimeout(() => {
      this.showHistory = false;
    }, 200);
  }

  updateHistoryDisplay() {
    this.groupedHistory = this.searchHistoryService.getGroupedHistory();
  }

  onSearchSubmit() {
    if (!this.searchQuery.trim()) {
      return;
    }
    
    this.performSearch();
    this.showSuggestions = false;
  }

  performSearch() {
    this.isLoading = true;
    this.searchResults = [];

    const options: SearchOptions = {
      searchType: this.searchType === 'auto' ? undefined : this.searchType,
      matchWholeWord: this.matchWholeWord,
      matchStart: this.matchStart,
      matchEnd: this.matchEnd
    };

    this.searchService.search(this.searchQuery, options).subscribe({
      next: (results) => {
        this.searchResults = results;
        this.isLoading = false;
        // Save to search history
        const searchType = this.searchType === 'auto' ? undefined : this.searchType;
        this.searchHistoryService.addSearch(this.searchQuery, results.length, searchType);
        this.showHistory = false;
      },
      error: (error) => {
        console.error('Search error:', error);
        this.isLoading = false;
      }
    });
  }

  getSuggestions(query: string) {
    this.searchService.getSuggestions(query, 10).subscribe({
      next: (sugs) => {
        this.suggestions = sugs;
      },
      error: () => {
        this.suggestions = [];
      }
    });
  }

  selectSuggestion(suggestion: string) {
    this.searchQuery = suggestion;
    this.showSuggestions = false;
    this.performSearch();
  }

  toggleAdvancedFilters() {
    this.showAdvancedFilters = !this.showAdvancedFilters;
  }

  onCharacterClick(character: string) {
    this.router.navigate(['/character', character]);
  }

  getDisplayCharacter(entry: DictionaryEntry): string {
    return this.showSimplified ? entry.simplified : entry.traditional;
  }

  getFontSizeClass(): string {
    return this.fontSize === 'small' ? 'chinese-font-small' : 'chinese-font-large';
  }

  selectHistoryItem(item: SearchHistoryItem) {
    this.searchQuery = item.query;
    this.showHistory = false;
    this.showSuggestions = false;
    this.performSearch();
  }

  toggleHistory() {
    this.showHistory = !this.showHistory;
    if (this.showHistory) {
      this.updateHistoryDisplay();
    }
  }

  clearHistory() {
    this.searchHistoryService.clearHistory();
    this.updateHistoryDisplay();
  }

  removeHistoryItem(query: string, event: Event) {
    event.stopPropagation();
    this.searchHistoryService.removeSearch(query);
    this.updateHistoryDisplay();
  }
}
