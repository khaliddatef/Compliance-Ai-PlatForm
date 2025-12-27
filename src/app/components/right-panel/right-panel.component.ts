import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComplianceResult } from '../../models/compliance-result.model';
import { ComplianceStandard } from '../../services/api.service';
import { StandardSelectorComponent } from '../standard-selector/standard-selector.component';

@Component({
  selector: 'app-right-panel',
  standalone: true,
  imports: [CommonModule, StandardSelectorComponent],
  templateUrl: './right-panel.component.html',
  styleUrl: './right-panel.component.css'
})
export class RightPanelComponent {
  @Input() open = true;
  @Input() loading = false;
  @Input() result: ComplianceResult | null = null;
  @Input() standard: ComplianceStandard = 'ISO';
  @Output() standardChange = new EventEmitter<ComplianceStandard>();
  @Output() close = new EventEmitter<void>();

  get statusTone() {
    const status = this.result?.status;
    if (status === 'Compliant') return 'good';
    if (status === 'Partially compliant') return 'warn';
    return 'bad';
  }
}
