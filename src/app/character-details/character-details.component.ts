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
  writers: HanziWriterInstance[] = [];
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
    // Clean up all writers
    this.writers.forEach(writer => {
      try {
        if (writer && typeof writer.cancel === 'function') {
          writer.cancel();
        }
      } catch (e) {
        // Ignore errors when destroying
      }
    });
    this.writers = [];
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

    // Get the displayed character string (may contain multiple characters)
    const displayedChar = this.getDisplayedCharacter();
    
    // Extract all Chinese characters from the string
    const characters = Array.from(displayedChar).filter(char => /[\u4e00-\u9fff]/.test(char));
    
    if (characters.length === 0) {
      return;
    }

    // Clear previous writers
    this.writers.forEach(writer => {
      try {
        if (writer && typeof writer.cancel === 'function') {
          writer.cancel();
        }
      } catch (e) {
        // Ignore errors when canceling
      }
    });
    this.writers = [];

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
      let baseWidth = 400;
      let baseHeight = 400;
      
      if (characterElement) {
        const rect = characterElement.getBoundingClientRect();
        // For multiple characters, use the full width of the text element
        // and calculate per-character width
        if (characters.length > 1) {
          baseWidth = rect.width;
          baseHeight = Math.max(rect.height, 300);
        } else {
          // Single character: use the larger dimension
          const size = Math.max(rect.width, rect.height) * 1.1;
          baseWidth = Math.max(size, 300);
          baseHeight = Math.max(size, 300);
        }
      }

      // Calculate width per character
      // For multiple characters, divide evenly; for single, use full width
      const widthPerChar = characters.length > 1 ? baseWidth / characters.length : baseWidth;
      const height = baseHeight;

      // Create a writer for each character
      characters.forEach((char, index) => {
        // Create a container div for this character
        const charContainer = document.createElement('div');
        charContainer.className = 'character-writer-container';
        charContainer.style.display = 'inline-block';
        charContainer.style.position = 'relative';
        charContainer.style.width = `${widthPerChar}px`;
        charContainer.style.height = `${height}px`;
        charContainer.style.verticalAlign = 'top';
        container.appendChild(charContainer);

        // Create HanziWriter instance for this character
        const writer = HanziWriter.create(charContainer, char, {
          width: widthPerChar,
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
        if (writer) {
          if (typeof writer.hideCharacter === 'function') {
            writer.hideCharacter();
          }
          if (typeof writer.hideOutline === 'function') {
            writer.hideOutline();
          }
        }

        this.writers.push(writer);

        // Make the SVG background transparent and center it
        setTimeout(() => {
          const svg = charContainer.querySelector('svg');
          if (svg) {
            svg.style.backgroundColor = 'transparent';
            svg.style.position = 'absolute';
            svg.style.top = '50%';
            svg.style.left = '50%';
            svg.style.transform = 'translate(-50%, -50%)';
            svg.style.pointerEvents = 'none';
          }
        }, 100);
      });

    } catch (error) {
      // Error initializing HanziWriter
      this.writers = [];
    }
  }

  animateCharacter() {
    if (this.writers.length === 0 || this.isAnimating) {
      return;
    }

    try {
      // Hide the black character text
      this.showCharacterText = false;
      
      // Show outlines for all writers
      this.writers.forEach(writer => {
        if (writer && typeof writer.showOutline === 'function') {
          writer.showOutline();
        }
      });
      
      this.isAnimating = true;
      
      // Animate all characters sequentially
      // Start with the first character
      let completedCount = 0;
      const totalWriters = this.writers.length;
      
      this.writers.forEach((writer, index) => {
        if (writer && typeof writer.animateCharacter === 'function') {
          // Add a small delay between characters for sequential animation
          setTimeout(() => {
            writer.animateCharacter({
              onComplete: () => {
                completedCount++;
                // When all characters are done animating
                if (completedCount === totalWriters) {
                  this.isAnimating = false;
                }
              }
            });
          }, index * 300); // 300ms delay between each character
        } else {
          completedCount++;
          if (completedCount === totalWriters) {
            this.isAnimating = false;
          }
        }
      });
      
      // If no writers have animateCharacter method, reset state
      if (this.writers.every(w => !w || typeof w.animateCharacter !== 'function')) {
        this.isAnimating = false;
      }
    } catch (error) {
      // Error animating character
      this.isAnimating = false;
      this.showCharacterText = true; // Restore character text on error
    }
  }

  resetCharacter() {
    if (this.writers.length === 0) {
      return;
    }
    
    try {
      // Cancel any ongoing animations for all writers
      this.writers.forEach(writer => {
        if (writer) {
          if (typeof writer.cancel === 'function') {
            writer.cancel();
          }
          
          // Hide character and outline if methods exist
          if (typeof writer.hideCharacter === 'function') {
            writer.hideCharacter();
          }
          if (typeof writer.hideOutline === 'function') {
            writer.hideOutline();
          }
        }
      });
    } catch (error) {
      // Error resetting character
    }
    
    // Show the black character text again
    this.showCharacterText = true;
    this.isAnimating = false;
  }

  quizCharacter() {
    if (this.writers.length === 0) {
      return;
    }
    // Quiz only the first character (hanzi-writer quiz mode typically works with single characters)
    if (this.writers[0] && typeof this.writers[0].quiz === 'function') {
      this.writers[0].quiz();
    }
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
      // Update character if it changed (supports both single and multiple characters)
      if (newChar !== this.character) {
        this.character = newChar;
        // Reinitialize writers with new character(s)
        setTimeout(() => {
          this.initializeWriter();
        }, 100);
      }
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
