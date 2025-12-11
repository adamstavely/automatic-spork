import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DictionaryService, DictionaryEntry } from '../dictionary.service';
import { SettingsService } from '../settings.service';

interface AnnotatedWord {
  text: string;
  entry: DictionaryEntry | null;
  isChinese: boolean;
}

@Component({
  selector: 'app-annotation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './annotation.component.html',
  styleUrls: ['./annotation.component.css']
})
export class AnnotationComponent implements OnInit {
  inputText = '';
  annotatedWords: AnnotatedWord[] = [];
  annotationMode: 'chinese-only' | 'chinese-pinyin' | 'chinese-pinyin-english' = 'chinese-pinyin';
  selectedWord: AnnotatedWord | null = null;
  popupPosition = { x: 0, y: 0 };
  showPopup = false;
  
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  constructor(
    private dictionaryService: DictionaryService,
    private settingsService: SettingsService,
    private router: Router
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
  }

  onTextInput() {
    this.annotateText();
  }

  annotateText() {
    if (!this.inputText.trim()) {
      this.annotatedWords = [];
      return;
    }

    // Simple word segmentation: split by spaces, or character-by-character for Chinese
    const words = this.segmentText(this.inputText);
    this.annotatedWords = words.map(word => ({
      text: word,
      entry: null,
      isChinese: /[\u4e00-\u9fff]/.test(word)
    }));

    // Lookup each word
    this.annotatedWords.forEach(word => {
      if (word.isChinese) {
        this.dictionaryService.lookupCharacter(word.text).subscribe({
          next: (entries) => {
            if (entries.length > 0) {
              word.entry = entries[0]; // Use first entry
            }
          }
        });
      }
    });
  }

  segmentText(text: string): string[] {
    // Simple segmentation: split by spaces, but keep Chinese characters together
    const segments: string[] = [];
    let currentSegment = '';
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isChinese = /[\u4e00-\u9fff]/.test(char);
      
      if (isChinese) {
        // Chinese character - add to current segment
        currentSegment += char;
      } else if (char === ' ' || char === '\n') {
        // Space or newline - finish current segment and start new one
        if (currentSegment) {
          segments.push(currentSegment);
          currentSegment = '';
        }
        if (char === '\n') {
          segments.push('\n');
        }
      } else {
        // Other character - add to current segment
        currentSegment += char;
      }
    }
    
    if (currentSegment) {
      segments.push(currentSegment);
    }
    
    return segments;
  }

  onWordClick(word: AnnotatedWord, event: MouseEvent) {
    if (word.entry) {
      this.selectedWord = word;
      this.popupPosition = { x: event.clientX, y: event.clientY };
      this.showPopup = true;
    }
  }

  onWordHover(word: AnnotatedWord, event: MouseEvent) {
    if (word.entry && this.annotationMode === 'chinese-only') {
      this.selectedWord = word;
      this.popupPosition = { x: event.clientX + 10, y: event.clientY + 10 };
      this.showPopup = true;
    }
  }

  closePopup() {
    this.showPopup = false;
    this.selectedWord = null;
  }

  navigateToCharacter(character: string) {
    this.closePopup();
    this.router.navigate(['/character', character]);
  }

  getDisplayCharacter(entry: DictionaryEntry | null): string {
    if (!entry) return '';
    return this.showSimplified ? entry.simplified : entry.traditional;
  }

  getFontSizeClass(): string {
    return this.fontSize === 'small' ? 'chinese-font-small' : 'chinese-font-large';
  }

  exportText() {
    // Export annotated text
    const exported = this.annotatedWords
      .map(word => {
        if (word.entry) {
          if (this.annotationMode === 'chinese-only') {
            return word.text;
          } else if (this.annotationMode === 'chinese-pinyin') {
            return `${word.text} (${word.entry.pinyin})`;
          } else {
            return `${word.text} (${word.entry.pinyin}) ${word.entry.definitions[0] || ''}`;
          }
        }
        return word.text;
      })
      .join(' ');
    
    // Copy to clipboard
    navigator.clipboard.writeText(exported).then(() => {
      alert('Text copied to clipboard!');
    });
  }
}
