import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PinyinInputService } from '../pinyin-input.service';

@Component({
  selector: 'app-pinyin-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pinyin-input.component.html',
  styleUrls: ['./pinyin-input.component.css']
})
export class PinyinInputComponent implements OnInit {
  @Input() placeholder: string = 'Type pinyin...';
  @Input() showSuggestions: boolean = true;
  @Input() maxSuggestions: number = 10;
  
  @Output() characterSelected = new EventEmitter<string>();
  @Output() pinyinChanged = new EventEmitter<string>();

  pinyinInput = '';
  characterSuggestions: string[] = [];
  pinyinSuggestions: string[] = [];
  showCharacterSuggestions = false;
  showPinyinSuggestions = false;

  constructor(private pinyinService: PinyinInputService) {}

  ngOnInit() {}

  onPinyinInput(value: string) {
    this.pinyinInput = value;
    this.pinyinChanged.emit(value);
    
    if (!value || value.length === 0) {
      this.characterSuggestions = [];
      this.pinyinSuggestions = [];
      this.showCharacterSuggestions = false;
      this.showPinyinSuggestions = false;
      return;
    }

    // Check if it looks like pinyin
    if (this.pinyinService.isPinyin(value)) {
      // Get character suggestions
      this.pinyinService.convertPinyinToCharacters(value).subscribe({
        next: (characters) => {
          this.characterSuggestions = characters.slice(0, this.maxSuggestions);
          this.showCharacterSuggestions = this.characterSuggestions.length > 0;
        },
        error: () => {
          this.characterSuggestions = [];
          this.showCharacterSuggestions = false;
        }
      });

      // Get pinyin suggestions for auto-complete
      if (this.showSuggestions) {
        this.pinyinService.getPinyinSuggestions(value, this.maxSuggestions).subscribe({
          next: (suggestions) => {
            this.pinyinSuggestions = suggestions;
            this.showPinyinSuggestions = this.pinyinSuggestions.length > 0;
          },
          error: () => {
            this.pinyinSuggestions = [];
            this.showPinyinSuggestions = false;
          }
        });
      }
    } else {
      this.characterSuggestions = [];
      this.pinyinSuggestions = [];
      this.showCharacterSuggestions = false;
      this.showPinyinSuggestions = false;
    }
  }

  selectCharacter(character: string) {
    this.characterSelected.emit(character);
    this.pinyinInput = '';
    this.characterSuggestions = [];
    this.pinyinSuggestions = [];
    this.showCharacterSuggestions = false;
    this.showPinyinSuggestions = false;
  }

  selectPinyinSuggestion(pinyin: string) {
    this.pinyinInput = pinyin;
    this.onPinyinInput(pinyin);
  }

  onBlur() {
    // Delay hiding to allow clicks
    setTimeout(() => {
      this.showCharacterSuggestions = false;
      this.showPinyinSuggestions = false;
    }, 200);
  }

  onFocus() {
    if (this.pinyinInput) {
      this.onPinyinInput(this.pinyinInput);
    }
  }
}
