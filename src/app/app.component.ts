import { Component, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, CommonModule],
  template: `
    <div class="container">
      <header class="card" style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #667eea; margin-bottom: 8px;">Linguist App</h1>
        <p style="color: #666;">Chinese Dictionary & Handwriting Recognition</p>
        
        <nav style="margin-top: 20px; margin-bottom: 20px;">
          <a routerLink="/search" class="btn btn-primary" style="margin-right: 12px; text-decoration: none; display: inline-block;">
            Search
          </a>
          <a routerLink="/handwriting" class="btn btn-primary" style="margin-right: 12px; text-decoration: none; display: inline-block;">
            Handwriting Recognition
          </a>
          <a routerLink="/radicals" class="btn btn-secondary" style="margin-right: 12px; text-decoration: none; display: inline-block;">
            Radicals & Strokes
          </a>
          <a routerLink="/annotation" class="btn btn-secondary" style="margin-right: 12px; text-decoration: none; display: inline-block;">
            Text Annotation
          </a>
          <a routerLink="/help" class="btn btn-secondary" style="text-decoration: none; display: inline-block;">
            Help
          </a>
        </nav>

        <div style="display: flex; justify-content: center; align-items: center; gap: 16px; flex-wrap: wrap; padding-top: 16px; border-top: 1px solid #e0e0e0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 14px; color: #666;">Font Size:</label>
            <button
              class="btn"
              [class.btn-primary]="fontSize === 'small'"
              [class.btn-secondary]="fontSize !== 'small'"
              (click)="setFontSize('small')"
              style="padding: 6px 12px; font-size: 14px;">
              Small
            </button>
            <button
              class="btn"
              [class.btn-primary]="fontSize === 'large'"
              [class.btn-secondary]="fontSize !== 'large'"
              (click)="setFontSize('large')"
              style="padding: 6px 12px; font-size: 14px;">
              Large
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 14px; color: #666;">Display:</label>
            <button
              class="btn"
              [class.btn-primary]="showSimplified"
              [class.btn-secondary]="!showSimplified"
              (click)="setShowSimplified(true)"
              style="padding: 6px 12px; font-size: 14px;">
              Simplified
            </button>
            <button
              class="btn"
              [class.btn-primary]="!showSimplified"
              [class.btn-secondary]="showSimplified"
              (click)="setShowSimplified(false)"
              style="padding: 6px 12px; font-size: 14px;">
              Traditional
            </button>
          </div>
        </div>
      </header>
      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      padding: 20px 0;
    }
  `]
})
export class AppComponent implements OnInit {
  title = 'Linguist App';
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  constructor(private settingsService: SettingsService) {}

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

  setFontSize(size: 'small' | 'large') {
    this.settingsService.setFontSize(size);
  }

  setShowSimplified(show: boolean) {
    this.settingsService.setShowSimplified(show);
  }
}

