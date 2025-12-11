import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DictionaryService } from '../dictionary.service';
import { SettingsService } from '../settings.service';

interface Radical {
  id: number;
  character: string;
  strokes: number;
  variant?: string;
}

@Component({
  selector: 'app-radicals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './radicals.component.html',
  styleUrls: ['./radicals.component.css']
})
export class RadicalsComponent implements OnInit {
  radicals: Radical[] = [];
  selectedRadical: Radical | null = null;
  radicalCharacters: string[] = [];
  isLoading = false;
  selectedStrokeCount: number | null = null;
  
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  // Radical data based on MDBG's radical table
  private radicalData: Radical[] = [
    // 1 stroke
    { id: 1, character: '一', strokes: 1 },
    { id: 2, character: '丨', strokes: 1 },
    { id: 3, character: '丶', strokes: 1 },
    { id: 4, character: '丿', strokes: 1 },
    { id: 5, character: '乙', strokes: 1, variant: '乚' },
    { id: 6, character: '亅', strokes: 1, variant: '了' },
    
    // 2 strokes
    { id: 7, character: '二', strokes: 2 },
    { id: 8, character: '亠', strokes: 2 },
    { id: 9, character: '人', strokes: 2, variant: '亻' },
    { id: 10, character: '儿', strokes: 2 },
    { id: 11, character: '入', strokes: 2 },
    { id: 12, character: '八', strokes: 2 },
    { id: 13, character: '冂', strokes: 2 },
    { id: 14, character: '冖', strokes: 2 },
    { id: 15, character: '冫', strokes: 2 },
    { id: 16, character: '几', strokes: 2 },
    { id: 17, character: '凵', strokes: 2 },
    { id: 18, character: '刀', strokes: 2, variant: '刂' },
    { id: 19, character: '力', strokes: 2 },
    { id: 20, character: '勹', strokes: 2 },
    { id: 21, character: '匕', strokes: 2 },
    { id: 22, character: '匚', strokes: 2 },
    { id: 23, character: '匸', strokes: 2 },
    { id: 24, character: '十', strokes: 2 },
    { id: 25, character: '卜', strokes: 2 },
    { id: 26, character: '卩', strokes: 2 },
    { id: 27, character: '厂', strokes: 2 },
    { id: 28, character: '厶', strokes: 2 },
    { id: 29, character: '又', strokes: 2 },
    
    // 3 strokes
    { id: 30, character: '口', strokes: 3 },
    { id: 31, character: '囗', strokes: 3 },
    { id: 32, character: '土', strokes: 3 },
    { id: 33, character: '士', strokes: 3 },
    { id: 34, character: '夂', strokes: 3 },
    { id: 35, character: '夊', strokes: 3 },
    { id: 36, character: '夕', strokes: 3 },
    { id: 37, character: '大', strokes: 3 },
    { id: 38, character: '女', strokes: 3 },
    { id: 39, character: '子', strokes: 3, variant: '孑' },
    { id: 40, character: '宀', strokes: 3 },
    { id: 41, character: '寸', strokes: 3 },
    { id: 42, character: '小', strokes: 3 },
    { id: 43, character: '尢', strokes: 3 },
    { id: 44, character: '尸', strokes: 3 },
    { id: 45, character: '屮', strokes: 3 },
    { id: 46, character: '山', strokes: 3 },
    { id: 47, character: '巛', strokes: 3, variant: '川' },
    { id: 48, character: '工', strokes: 3 },
    { id: 49, character: '己', strokes: 3, variant: '已/巳' },
    { id: 50, character: '巾', strokes: 3 },
    { id: 51, character: '干', strokes: 3 },
    { id: 52, character: '幺', strokes: 3, variant: '乡' },
    { id: 53, character: '广', strokes: 3 },
    { id: 54, character: '廴', strokes: 3 },
    { id: 55, character: '廾', strokes: 3 },
    { id: 56, character: '弋', strokes: 3 },
    { id: 57, character: '弓', strokes: 3 },
    { id: 58, character: '彐', strokes: 3, variant: '彑' },
    { id: 59, character: '彡', strokes: 3 },
    { id: 60, character: '彳', strokes: 3 },
    { id: 61, character: '心', strokes: 3, variant: '忄' },
    { id: 64, character: '手', strokes: 3, variant: '扌' },
    { id: 85, character: '水', strokes: 3, variant: '氵/氺' },
    { id: 94, character: '犬', strokes: 3, variant: '犭' },
    
    // 4 strokes
    { id: 62, character: '戈', strokes: 4 },
    { id: 63, character: '戶', strokes: 4, variant: '户' },
    { id: 65, character: '支', strokes: 4 },
    { id: 66, character: '攴', strokes: 4, variant: '攵' },
    { id: 67, character: '文', strokes: 4 },
    { id: 68, character: '斗', strokes: 4 },
    { id: 69, character: '斤', strokes: 4 },
    { id: 70, character: '方', strokes: 4 },
    { id: 71, character: '无', strokes: 4 },
    { id: 72, character: '日', strokes: 4 },
    { id: 73, character: '曰', strokes: 4 },
    { id: 74, character: '月', strokes: 4 },
    { id: 75, character: '木', strokes: 4 },
    { id: 76, character: '欠', strokes: 4 },
    { id: 77, character: '止', strokes: 4 },
    { id: 78, character: '歹', strokes: 4 },
    { id: 79, character: '殳', strokes: 4 },
    { id: 80, character: '毋', strokes: 4, variant: '母' },
    { id: 81, character: '比', strokes: 4 },
    { id: 82, character: '毛', strokes: 4 },
    { id: 83, character: '氏', strokes: 4 },
    { id: 84, character: '气', strokes: 4 },
    { id: 86, character: '火', strokes: 4, variant: '灬' },
    { id: 87, character: '爪', strokes: 4, variant: '爫' },
    { id: 88, character: '父', strokes: 4 },
    { id: 89, character: '爻', strokes: 4 },
    { id: 90, character: '爿', strokes: 4 },
    { id: 91, character: '片', strokes: 4 },
    { id: 92, character: '牙', strokes: 4 },
    { id: 93, character: '牛', strokes: 4, variant: '牜' },
    { id: 96, character: '玉', strokes: 4, variant: '玊/王' },
    { id: 97, character: '瓜', strokes: 5 },
    { id: 98, character: '瓦', strokes: 5 },
    { id: 99, character: '甘', strokes: 5 },
    { id: 100, character: '生', strokes: 5 },
    { id: 101, character: '用', strokes: 5 },
    { id: 102, character: '田', strokes: 5 },
    { id: 103, character: '疋', strokes: 5, variant: '⺪' },
    { id: 104, character: '疒', strokes: 5 },
    { id: 105, character: '癶', strokes: 5 },
    { id: 106, character: '白', strokes: 5 },
    { id: 107, character: '皮', strokes: 5 },
    { id: 108, character: '皿', strokes: 5 },
    { id: 109, character: '目', strokes: 5 },
    { id: 110, character: '矛', strokes: 5 },
    { id: 111, character: '矢', strokes: 5 },
    { id: 112, character: '石', strokes: 5 },
    { id: 113, character: '示', strokes: 5, variant: '礻' },
    { id: 114, character: '禸', strokes: 5 },
    { id: 115, character: '禾', strokes: 5 },
    { id: 116, character: '穴', strokes: 5 },
    { id: 117, character: '立', strokes: 5 },
    
    // 6 strokes
    { id: 118, character: '竹', strokes: 6, variant: '⺮' },
    { id: 119, character: '米', strokes: 6 },
    { id: 120, character: '糸', strokes: 6, variant: '纟' },
    { id: 121, character: '缶', strokes: 6 },
    { id: 122, character: '网', strokes: 6, variant: '罒' },
    { id: 123, character: '羊', strokes: 6, variant: '⺶/⺷' },
    { id: 124, character: '羽', strokes: 6 },
    { id: 125, character: '老', strokes: 6, variant: '耂' },
    { id: 126, character: '而', strokes: 6 },
    { id: 127, character: '耒', strokes: 6 },
    { id: 128, character: '耳', strokes: 6 },
    { id: 129, character: '聿', strokes: 6 },
    { id: 130, character: '肉', strokes: 6, variant: '⺼' },
    { id: 131, character: '臣', strokes: 6 },
    { id: 132, character: '自', strokes: 6 },
    { id: 133, character: '至', strokes: 6 },
    { id: 134, character: '臼', strokes: 6 },
    { id: 135, character: '舌', strokes: 6 },
    { id: 136, character: '舛', strokes: 6 },
    { id: 137, character: '舟', strokes: 6 },
    { id: 138, character: '艮', strokes: 6 },
    { id: 139, character: '色', strokes: 6 },
    { id: 140, character: '艸', strokes: 6, variant: '艹' },
    { id: 141, character: '虍', strokes: 6 },
    { id: 142, character: '虫', strokes: 6 },
    { id: 143, character: '血', strokes: 6 },
    { id: 144, character: '行', strokes: 6 },
    { id: 145, character: '衣', strokes: 6, variant: '衤' },
    { id: 146, character: '襾', strokes: 6, variant: '覀' },
    
    // 7 strokes
    { id: 147, character: '見', strokes: 7, variant: '见' },
    { id: 148, character: '角', strokes: 7 },
    { id: 149, character: '言', strokes: 7, variant: '讠' },
    { id: 150, character: '谷', strokes: 7 },
    { id: 151, character: '豆', strokes: 7 },
    { id: 152, character: '豕', strokes: 7 },
    { id: 153, character: '豸', strokes: 7 },
    { id: 154, character: '貝', strokes: 7, variant: '贝' },
    { id: 155, character: '赤', strokes: 7 },
    { id: 156, character: '走', strokes: 7, variant: '赱' },
    { id: 157, character: '足', strokes: 7, variant: '⻊' },
    { id: 158, character: '身', strokes: 7 },
    { id: 159, character: '車', strokes: 7, variant: '车' },
    { id: 160, character: '辛', strokes: 7 },
    { id: 161, character: '辰', strokes: 7 },
    { id: 162, character: '辵', strokes: 7, variant: '辶' },
    { id: 163, character: '邑', strokes: 7, variant: '阝' },
    { id: 164, character: '酉', strokes: 7 },
    { id: 165, character: '釆', strokes: 7 },
    { id: 166, character: '里', strokes: 7 },
    
    // 8 strokes
    { id: 167, character: '金', strokes: 8, variant: '钅' },
    { id: 168, character: '長', strokes: 8, variant: '长' },
    { id: 169, character: '門', strokes: 8, variant: '门' },
    { id: 170, character: '阜', strokes: 8, variant: '阝' },
    { id: 171, character: '隶', strokes: 8 },
    { id: 172, character: '隹', strokes: 8 },
    { id: 173, character: '雨', strokes: 8 },
    { id: 174, character: '靑', strokes: 8, variant: '青' },
    { id: 175, character: '非', strokes: 8 },
    
    // 9 strokes
    { id: 176, character: '面', strokes: 9, variant: '靣' },
    { id: 177, character: '革', strokes: 9 },
    { id: 178, character: '韋', strokes: 9, variant: '韦' },
    { id: 179, character: '韭', strokes: 9 },
    { id: 180, character: '音', strokes: 9 },
    { id: 181, character: '頁', strokes: 9, variant: '页' },
    { id: 182, character: '風', strokes: 9, variant: '风' },
    { id: 183, character: '飛', strokes: 9, variant: '飞' },
    { id: 184, character: '食', strokes: 9, variant: '饣' },
    { id: 185, character: '首', strokes: 9 },
    { id: 186, character: '香', strokes: 9 },
    
    // 10 strokes
    { id: 187, character: '馬', strokes: 10, variant: '马' },
    { id: 188, character: '骨', strokes: 10 },
    { id: 189, character: '高', strokes: 10, variant: '髙' },
    { id: 190, character: '髟', strokes: 10 },
    { id: 191, character: '鬥', strokes: 10 },
    { id: 192, character: '鬯', strokes: 10 },
    { id: 193, character: '鬲', strokes: 10 },
    { id: 194, character: '鬼', strokes: 10 },
    
    // 11 strokes
    { id: 195, character: '魚', strokes: 11, variant: '鱼' },
    { id: 196, character: '鳥', strokes: 11, variant: '鸟' },
    { id: 197, character: '鹵', strokes: 11, variant: '卤' },
    { id: 198, character: '鹿', strokes: 11 },
    { id: 199, character: '麥', strokes: 11, variant: '麦' },
    { id: 200, character: '麻', strokes: 11 },
    
    // 12 strokes
    { id: 201, character: '黃', strokes: 12, variant: '黄' },
    { id: 202, character: '黍', strokes: 12 },
    { id: 203, character: '黑', strokes: 12 },
    { id: 204, character: '黹', strokes: 12 },
    
    // 13 strokes
    { id: 205, character: '黽', strokes: 13, variant: '黾' },
    { id: 206, character: '鼎', strokes: 13 },
    { id: 207, character: '鼓', strokes: 13 },
    { id: 208, character: '鼠', strokes: 13 },
    
    // 14 strokes
    { id: 209, character: '鼻', strokes: 14 },
    { id: 210, character: '齊', strokes: 14, variant: '齐' },
    
    // 15 strokes
    { id: 211, character: '齒', strokes: 15, variant: '齿' },
    
    // 16 strokes
    { id: 212, character: '龍', strokes: 16, variant: '龙' },
    { id: 213, character: '龜', strokes: 16, variant: '龟' },
    
    // 17 strokes
    { id: 214, character: '龠', strokes: 17 }
  ];

  constructor(
    private dictionaryService: DictionaryService,
    private settingsService: SettingsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.radicals = this.radicalData;
    this.fontSize = this.settingsService.getFontSize();
    this.showSimplified = this.settingsService.getShowSimplified();
    
    this.settingsService.getFontSize$().subscribe(size => {
      this.fontSize = size;
    });
    
    this.settingsService.getShowSimplified$().subscribe(show => {
      this.showSimplified = show;
    });
  }

  getRadicalsByStrokes(strokes: number): Radical[] {
    return this.radicals.filter(r => r.strokes === strokes);
  }

  getUniqueStrokeCounts(): number[] {
    return [...new Set(this.radicals.map(r => r.strokes))].sort((a, b) => a - b);
  }

  selectRadical(radical: Radical) {
    this.selectedRadical = radical;
    this.loadRadicalCharacters(radical.id);
  }

  filterByStrokes(strokes: number | null) {
    this.selectedStrokeCount = strokes;
  }

  getFilteredRadicals(): Radical[] {
    if (this.selectedStrokeCount === null) {
      return this.radicals;
    }
    return this.radicals.filter(r => r.strokes === this.selectedStrokeCount);
  }

  async loadRadicalCharacters(radicalId: number) {
    this.isLoading = true;
    try {
      const characters = await this.dictionaryService.getRadicalCharacters(radicalId).toPromise();
      this.radicalCharacters = characters || [];
    } catch (error) {
      console.error('Error loading radical characters:', error);
      this.radicalCharacters = [];
    } finally {
      this.isLoading = false;
    }
  }

  async lookupCharacter(character: string) {
    this.router.navigate(['/character', character]);
  }

  getFontSizeClass(): string {
    return this.fontSize === 'small' ? 'chinese-font-small' : 'chinese-font-large';
  }
}

