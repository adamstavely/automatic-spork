import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DictionaryService, DictionaryEntry, FrequencyData, RelatedWord, CharacterDecomposition } from '../dictionary.service';
import { SettingsService } from '../settings.service';
import { HanziWriterInstance, HanziWriterStatic } from '../types/hanzi-writer.types';
// Import hanzi-writer - handle module format differences
import * as HanziWriterModule from 'hanzi-writer';
// Handle both ESM and CommonJS module formats
const HanziWriter = ((HanziWriterModule as any).default || HanziWriterModule) as HanziWriterStatic;

@Component({
  selector: 'app-character-details',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './character-details.component.html',
  styleUrls: ['./character-details.component.css']
})
export class CharacterDetailsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('writerTarget', { static: false }) writerTarget!: ElementRef<HTMLDivElement>;
  
  character: string = '';
  dictionaryEntries: DictionaryEntry[] = [];
  isLoading = false;
  writer: HanziWriterInstance | null = null;
  isAnimating = false;
  showCharacterText = true;  // Show black character by default
  frequencyData: FrequencyData | null = null;
  relatedWords: RelatedWord[] = [];
  similarCharacters: Array<{ character: string; score: number; reasons: string[] }> = [];
  characterDecomposition: CharacterDecomposition | null = null;
  
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private dictionaryService: DictionaryService,
    private settingsService: SettingsService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.fontSize = this.settingsService.getFontSize();
    this.showSimplified = this.settingsService.getShowSimplified();
    
    this.settingsService.getFontSize$().subscribe(size => {
      this.fontSize = size;
    });
    
    this.settingsService.getShowSimplified$().subscribe(show => {
      this.showSimplified = show;
      // Update displayed character when setting changes
      this.updateDisplayedCharacter();
    });
    
    this.route.paramMap.subscribe(params => {
      const char = params.get('char');
      if (char) {
        this.character = char;
        this.loadCharacterData();
      }
    });
  }

  ngAfterViewInit() {
    // Initialize writer after view is ready
    // Use ChangeDetectorRef to ensure view is updated
    this.cdr.detectChanges();
    setTimeout(() => {
      this.initializeWriter();
    }, 200);
  }

  ngOnDestroy() {
    if (this.writer) {
      try {
        if (typeof this.writer.cancel === 'function') {
          this.writer.cancel();
        }
      } catch (e) {
        // Ignore errors when destroying
      }
    }
  }

  loadCharacterData() {
    this.isLoading = true;
    this.dictionaryService.lookupCharacter(this.character).subscribe({
      next: (entries) => {
        this.dictionaryEntries = entries;
        this.isLoading = false;
        // Load frequency data
        this.loadFrequencyData();
        // Load related words
        this.loadRelatedWords();
        // Load similar characters
        this.loadSimilarCharacters();
        // Load character decomposition
        this.loadCharacterDecomposition();
        // Reinitialize writer with new character
        this.cdr.detectChanges();
        setTimeout(() => {
          this.initializeWriter();
        }, 200);
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  loadFrequencyData() {
    if (this.character && this.character.length === 1) {
      this.dictionaryService.getWordFrequency(this.character).subscribe({
        next: (frequency) => {
          this.frequencyData = frequency;
        },
        error: () => {
          // Error handled silently
        }
      });
    }
  }

  loadRelatedWords() {
    if (this.character) {
      this.dictionaryService.getRelatedWords(this.character, 15).subscribe({
        next: (related) => {
          this.relatedWords = related;
        },
        error: () => {
          // Error handled silently
        }
      });
    }
  }

  loadSimilarCharacters() {
    if (this.character && this.character.length === 1) {
      this.dictionaryService.findSimilarCharacters(this.character, 12).subscribe({
        next: (similar) => {
          this.similarCharacters = similar;
        },
        error: () => {
          // Error handled silently
        }
      });
    }
  }

  loadCharacterDecomposition() {
    if (this.character && this.character.length === 1) {
      this.dictionaryService.decomposeCharacter(this.character).subscribe({
        next: (decomposition) => {
          this.characterDecomposition = decomposition;
        },
        error: () => {
          // Error handled silently
        }
      });
    }
  }

  getFrequencyBadgeClass(): string {
    if (!this.frequencyData) return '';
    switch (this.frequencyData.frequency) {
      case 'common':
        return 'frequency-badge-common';
      case 'uncommon':
        return 'frequency-badge-uncommon';
      case 'rare':
        return 'frequency-badge-rare';
      default:
        return '';
    }
  }

  getRelationshipLabel(relationship: string): string {
    const labels: { [key: string]: string } = {
      'same-radical': 'Same Radical',
      'contains-character': 'Contains Character',
      'similar-meaning': 'Similar Meaning',
      'same-pinyin': 'Same Pinyin',
      'shared-component': 'Shared Component'
    };
    return labels[relationship] || relationship;
  }

  initializeWriter() {
    // Check prerequisites
    if (!this.character || this.character.length === 0) {
      return;
    }

    if (!this.writerTarget || !this.writerTarget.nativeElement) {
      return;
    }

    // Ensure we only process single characters
    const charToWrite = this.character.length === 1 ? this.character : this.character[0];
    
    // Check if character is a valid Chinese character
    if (!/[\u4e00-\u9fff]/.test(charToWrite)) {
      return;
    }

    // Clear previous writer
    if (this.writer) {
      try {
        if (typeof this.writer.cancel === 'function') {
          this.writer.cancel();
        }
      } catch (e) {
        // Ignore errors when canceling
      }
      this.writer = null;
    }

    // Clear the container
    const container = this.writerTarget.nativeElement;
    if (container) {
      container.innerHTML = '';
    }

    try {
      // Verify HanziWriter is available
      if (!HanziWriter || !HanziWriter.create) {
        return;
      }

      // Get the character text element to match its size
      const characterContainer = container.parentElement?.querySelector('.character-text-wrapper');
      const characterElement = characterContainer?.querySelector('.main-character') as HTMLElement;
      
      // Calculate size based on character element or use defaults
      let width = 400;
      let height = 400;
      
      if (characterElement) {
        const rect = characterElement.getBoundingClientRect();
        // Use the larger dimension and add some padding for proper alignment
        const size = Math.max(rect.width, rect.height) * 1.1;
        width = Math.max(size, 300);
        height = Math.max(size, 300);
      }

      // Create HanziWriter instance as overlay
      this.writer = HanziWriter.create(container, charToWrite, {
        width: width,
        height: height,
        padding: 0,
        strokeColor: '#667eea',
        radicalColor: '#ff6b6b',
        strokeAnimationSpeed: 2,
        delayBetweenStrokes: 200,
        showOutline: true,  // Show outline when animating
        showCharacter: false,  // We use text character instead
        charColor: 'transparent'  // Don't show hanzi-writer's character
      });

      // Initially hide the writer (show character text instead)
      if (this.writer) {
        if (typeof this.writer.hideCharacter === 'function') {
          this.writer.hideCharacter();
        }
        if (typeof this.writer.hideOutline === 'function') {
          this.writer.hideOutline();
        }
      }

      // Make the SVG background transparent and center it
      setTimeout(() => {
        const svg = container.querySelector('svg');
        if (svg) {
          svg.style.backgroundColor = 'transparent';
          svg.style.position = 'absolute';
          svg.style.top = '50%';
          svg.style.left = '50%';
          svg.style.transform = 'translate(-50%, -50%)';
          svg.style.pointerEvents = 'none';
        }
      }, 100);

    } catch (error) {
      // Error initializing HanziWriter
      this.writer = null;
    }
  }

  animateCharacter() {
    if (!this.writer || this.isAnimating) {
      return;
    }

    try {
      // Hide the black character text
      this.showCharacterText = false;
      
      // Show the outline if method exists
      if (typeof this.writer.showOutline === 'function') {
        this.writer.showOutline();
      }
      
      this.isAnimating = true;
      
      // Start animation if method exists
      if (typeof this.writer.animateCharacter === 'function') {
        this.writer.animateCharacter({
          onComplete: () => {
            this.isAnimating = false;
          }
        });
      } else {
        this.isAnimating = false;
        // animateCharacter method not available
      }
    } catch (error) {
      // Error animating character
      this.isAnimating = false;
      this.showCharacterText = true; // Restore character text on error
    }
  }

  resetCharacter() {
    if (!this.writer) {
      return;
    }
    
    try {
      // Cancel any ongoing animation if the method exists
      if (typeof this.writer.cancel === 'function') {
        this.writer.cancel();
      }
      
      // Hide character and outline if methods exist
      if (typeof this.writer.hideCharacter === 'function') {
        this.writer.hideCharacter();
      }
      if (typeof this.writer.hideOutline === 'function') {
        this.writer.hideOutline();
      }
    } catch (error) {
      // Error resetting character
    }
    
    // Show the black character text again
    this.showCharacterText = true;
    this.isAnimating = false;
  }

  quizCharacter() {
    if (!this.writer) {
      return;
    }
    this.writer.quiz();
  }

  /**
   * Get the character to display based on the simplified/traditional setting
   */
  getDisplayedCharacter(): string {
    if (this.dictionaryEntries.length > 0) {
      const entry = this.dictionaryEntries[0];
      return this.showSimplified ? entry.simplified : entry.traditional;
    }
    // Fallback to route parameter if no dictionary entries
    return this.character;
  }

  getDisplayCharacter(entry: DictionaryEntry): string {
    return this.showSimplified ? entry.simplified : entry.traditional;
  }

  /**
   * Update the displayed character when setting changes
   */
  private updateDisplayedCharacter() {
    if (this.dictionaryEntries.length > 0) {
      const entry = this.dictionaryEntries[0];
      const newChar = this.showSimplified ? entry.simplified : entry.traditional;
      // For single characters, update the character and reinitialize writer
      if (newChar.length === 1 && newChar !== this.character) {
        this.character = newChar;
        // Reinitialize writer with new character
        setTimeout(() => {
          this.initializeWriter();
        }, 100);
      }
      // For multi-character entries, we don't update the character variable
      // but the display will still update via getDisplayedCharacter()
    }
  }

  getFontSizeClass(): string {
    return this.fontSize === 'small' ? 'chinese-font-small' : 'chinese-font-large';
  }

  goBack() {
    this.router.navigate(['/search']);
  }

  onCharacterClick(character: string) {
    this.router.navigate(['/character', character]);
  }

  getStructureLabel(structure: string): string {
    const labels: { [key: string]: string } = {
      'left-right': 'Left-Right',
      'top-bottom': 'Top-Bottom',
      'enclosure': 'Enclosure',
      'complex': 'Complex',
      'component-based': 'Component-Based',
      'standalone': 'Standalone'
    };
    return labels[structure] || structure;
  }
}
