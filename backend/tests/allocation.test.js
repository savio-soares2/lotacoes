import { describe, expect, it } from 'vitest'
import { allocate } from '../src/allocation.js'

describe('allocate', () => {
  it('prioritizes first choice and applies service time and age tie-break', () => {
    const applicants = [
      {
        rowId: 2,
        identifier: '1',
        name: 'Ana',
        admissionDate: new Date('2010-01-01'),
        birthDate: new Date('1980-01-01'),
        choices: ['Unidade A', 'Unidade B', 'Unidade C'],
      },
      {
        rowId: 3,
        identifier: '2',
        name: 'Bruno',
        admissionDate: new Date('2010-01-01'),
        birthDate: new Date('1990-01-01'),
        choices: ['Unidade A', 'Unidade B', 'Unidade C'],
      },
    ]

    const result = allocate(applicants, { 'Unidade A': 1 }, new Date('2026-03-15'))

    expect(result.lotacoes).toHaveLength(1)
    expect(result.lotacoes[0].nome).toBe('Ana')
    expect(result.desempate_manual).toHaveLength(0)
  })
})
