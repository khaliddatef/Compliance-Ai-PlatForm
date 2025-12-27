import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComplianceStandard } from '../../services/api.service';

@Component({
  selector: 'app-standard-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './standard-selector.component.html',
  styleUrl: './standard-selector.component.css'
})
export class StandardSelectorComponent {
  @Input() value: ComplianceStandard = 'ISO';
  @Output() valueChange = new EventEmitter<ComplianceStandard>();

  standards: ComplianceStandard[] = ['ISO', 'FRA', 'CBE'];

  select(standard: ComplianceStandard) {
    this.valueChange.emit(standard);
  }
}
