import { Routes } from '@angular/router';
import { HandwritingComponent } from './handwriting/handwriting.component';
import { RadicalsComponent } from './radicals/radicals.component';
import { SearchComponent } from './search/search.component';
import { AnnotationComponent } from './annotation/annotation.component';
import { CharacterDetailsComponent } from './character-details/character-details.component';
import { HelpComponent } from './help/help.component';

export const routes: Routes = [
  { path: '', redirectTo: '/search', pathMatch: 'full' },
  { path: 'search', component: SearchComponent },
  { path: 'handwriting', component: HandwritingComponent },
  { path: 'radicals', component: RadicalsComponent },
  { path: 'annotation', component: AnnotationComponent },
  { path: 'character/:char', component: CharacterDetailsComponent },
  { path: 'help', component: HelpComponent }
];

