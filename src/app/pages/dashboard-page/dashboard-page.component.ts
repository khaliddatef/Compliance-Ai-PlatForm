import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent {
  stats = [
    { label: 'Overall Coverage', value: '72%', note: '+8% this month' },
    { label: 'Open Gaps', value: '14', note: '3 critical' },
    { label: 'Evidence Items', value: '86', note: '12 awaiting review' },
    { label: 'Last Review', value: '2d ago', note: 'ISO 27001' }
  ];

  riskRows = [
    { control: 'A.9 Access Control', owner: 'Security', status: 'Partial', due: 'Jan 21' },
    { control: 'A.12 Operations', owner: 'IT Ops', status: 'Missing', due: 'Jan 24' },
    { control: 'A.15 Supplier Mgmt', owner: 'Procurement', status: 'Missing', due: 'Jan 28' }
  ];

  activityRows = [
    { item: 'PolicyHub v4.1 uploaded', by: 'H. Samir', time: '2 hours ago' },
    { item: 'ISO 27001 mapping updated', by: 'M. Fawzy', time: 'Yesterday' },
    { item: 'New control gap detected', by: 'AI Assistant', time: 'Yesterday' }
  ];
}
