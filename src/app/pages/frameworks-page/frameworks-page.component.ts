import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-frameworks-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './frameworks-page.component.html',
  styleUrl: './frameworks-page.component.css'
})
export class FrameworksPageComponent {
  frameworks = [
    { name: 'ISO 27001', status: 'Active', coverage: '72%' },
    { name: 'FRA Egypt', status: 'Draft', coverage: '41%' },
    { name: 'SOC 2', status: 'Active', coverage: '58%' }
  ];
}
