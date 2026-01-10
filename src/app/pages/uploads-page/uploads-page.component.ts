import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-uploads-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './uploads-page.component.html',
  styleUrl: './uploads-page.component.css'
})
export class UploadsPageComponent {
  files = [
    { name: 'PolicyHub_2025.pdf', standard: 'ISO 27001', status: 'Indexed', size: '2.4 MB' },
    { name: 'Access_Review_Q4.xlsx', standard: 'FRA', status: 'Review', size: '860 KB' },
    { name: 'SOC2_Control_Map.docx', standard: 'SOC 2', status: 'Queued', size: '1.1 MB' }
  ];
}
