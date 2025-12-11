import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DictionaryService, DictionaryEntry } from '../dictionary.service';
import { SearchService, SearchOptions } from '../search.service';
import { SettingsService } from '../settings.service';
import { SearchHistoryService, SearchHistoryItem } from '../search-history.service';
import { PinyinInputService } from '../pinyin-input.service';

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
  pinyinCharacterSuggestions: string[] = [];
  isLoading = false;
  showSuggestions = false;
  showPinyinSuggestions = false;
  showAdvancedFilters = false;
  showHistory = false;
  searchHistory: SearchHistoryItem[] = [];
  groupedHistory: { label: string; items: SearchHistoryItem[] }[] = [];
  
  // Advanced filter options
  searchType: 'auto' | 'chinese' | 'pinyin' | 'english' = 'auto';
  matchWholeWord = false;
  matchStart = false;
  matchEnd = false;
  
  // Additional filters
  strokeCountMin: number | null = null;
  strokeCountMax: number | null = null;
  selectedRadicalId: number | null = null;
  frequencyLevel: 'common' | 'uncommon' | 'rare' | null = null;
  hskLevel: number | null = null;
  
  // Available radicals for filter dropdown
  availableRadicals: Array<{ id: number; character: string; strokes: number }> = [];
  
  // Settings
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  constructor(
    private searchService: SearchService,
    private dictionaryService: DictionaryService,
    private settingsService: SettingsService,
    private router: Router,
    private searchHistoryService: SearchHistoryService,
    private pinyinInputService: PinyinInputService
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
    
    // Load available radicals for filter
    this.loadAvailableRadicals();
  }
  
  loadAvailableRadicals() {
    // Get radicals from the radicals component data
    // Creates a subset of common radicals for search filtering
    this.availableRadicals = [
      { id: 1, character: '一', strokes: 1 },
      { id: 9, character: '人', strokes: 2 },
      { id: 30, character: '口', strokes: 3 },
      { id: 32, character: '土', strokes: 3 },
      { id: 38, character: '女', strokes: 3 },
      { id: 40, character: '宀', strokes: 3 },
      { id: 46, character: '山', strokes: 3 },
      { id: 48, character: '工', strokes: 3 },
      { id: 61, character: '心', strokes: 3 },
      { id: 64, character: '手', strokes: 3 },
      { id: 72, character: '日', strokes: 4 },
      { id: 75, character: '木', strokes: 4 },
      { id: 85, character: '水', strokes: 3 },
      { id: 86, character: '火', strokes: 4 },
      { id: 94, character: '犬', strokes: 3 },
      { id: 118, character: '竹', strokes: 6 },
      { id: 120, character: '糸', strokes: 6 },
      { id: 140, character: '艸', strokes: 6 },
      { id: 142, character: '虫', strokes: 6 },
      { id: 149, character: '言', strokes: 7 },
      { id: 162, character: '辵', strokes: 7 },
      { id: 167, character: '金', strokes: 8 },
      { id: 195, character: '魚', strokes: 11 },
      { id: 196, character: '鳥', strokes: 11 }
    ];
  }

  onSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    
    if (value.length > 0) {
      // Check if it's pinyin and get character suggestions
      if (this.pinyinInputService.isPinyin(value)) {
        this.pinyinInputService.convertPinyinToCharacters(value).subscribe({
          next: (characters) => {
            this.pinyinCharacterSuggestions = characters.slice(0, 10);
            this.showPinyinSuggestions = this.pinyinCharacterSuggestions.length > 0;
          },
          error: () => {
            this.pinyinCharacterSuggestions = [];
            this.showPinyinSuggestions = false;
          }
        });
      } else {
        this.pinyinCharacterSuggestions = [];
        this.showPinyinSuggestions = false;
      }
      
      this.getSuggestions(value);
      this.showSuggestions = true;
      this.showHistory = false;
    } else {
      this.suggestions = [];
      this.pinyinCharacterSuggestions = [];
      this.showSuggestions = false;
      this.showPinyinSuggestions = false;
      this.searchResults = [];
      // Show history when input is empty
      this.updateHistoryDisplay();
    }
  }
  
  selectPinyinCharacter(character: string) {
    this.searchQuery = character;
    this.showPinyinSuggestions = false;
    this.showSuggestions = false;
    this.performSearch();
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
      matchEnd: this.matchEnd,
      strokeCountMin: this.strokeCountMin ?? undefined,
      strokeCountMax: this.strokeCountMax ?? undefined,
      radicalId: this.selectedRadicalId ?? undefined,
      frequencyLevel: this.frequencyLevel ?? undefined,
      hskLevel: this.hskLevel ?? undefined
    };

    this.searchService.search(this.searchQuery, options).subscribe({
      next: (results) => {
        // Filters are already applied in search service
        this.searchResults = results;
        this.isLoading = false;
        // Save to search history
        const searchType = this.searchType === 'auto' ? undefined : this.searchType;
        this.searchHistoryService.addSearch(this.searchQuery, results.length, searchType);
        this.showHistory = false;
      },
      error: (error) => {
        // Search error handled
        this.isLoading = false;
      }
    });
  }
  
  clearFilters() {
    this.strokeCountMin = null;
    this.strokeCountMax = null;
    this.selectedRadicalId = null;
    this.frequencyLevel = null;
    this.hskLevel = null;
    if (this.searchQuery) {
      this.performSearch();
    }
  }
  
  hasActiveFilters(): boolean {
    return this.strokeCountMin !== null ||
           this.strokeCountMax !== null ||
           this.selectedRadicalId !== null ||
           this.frequencyLevel !== null ||
           this.hskLevel !== null;
  }
  
  getRadicalDisplay(radicalId: number): string {
    const radical = this.availableRadicals.find(r => r.id === radicalId);
    return radical ? radical.character : '';
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
