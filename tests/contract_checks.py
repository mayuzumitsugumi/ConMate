"""T01 specification checks, not tests of an implemented ConMate application.

Standard library only. Exact Fraction arithmetic is an independent fixture oracle;
production TypeScript financial services and XLSX readers do not exist yet.
"""

import json
import unittest
from fractions import Fraction
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT / path).read_text())


class ContractChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = load('docs/contracts/workbook.json')
        cls.issues = load('docs/contracts/issues.json')['issues']
        cls.workspace = load('tests/fixtures/contracts/workspace.json')
        cls.finances = load('tests/fixtures/contracts/finance.json')['cases']
        cls.entities = {s['entity']: s for s in cls.book['sheets'] if s['entity']}

    def case(self, case_id):
        return next(case for case in self.finances if case['id'] == case_id)

    def test_sheet_and_column_identity(self):
        sheets = self.book['sheets']
        self.assertEqual(sheets[0]['name'], '00_使用說明')
        self.assertEqual(len(sheets), 66)
        self.assertEqual(len({s['name'] for s in sheets}), len(sheets))
        for sheet in sheets:
            self.assertLessEqual(len(sheet['name']), 31)
            for field in ['key', 'label']:
                values = [c[field] for c in sheet['columns']]
                self.assertEqual(len(values), len(set(values)), (sheet['name'], field))
            for column in sheet['columns']:
                if column['key'] in ['id', 'displayCode', 'revision', 'createdAt', 'updatedAt']:
                    self.assertFalse(column['editable'])

    def test_all_reference_targets_and_enums_exist(self):
        targets = set(self.entities) | set(self.book['systemEntities'])
        for sheet in self.book['sheets']:
            for column in sheet['columns']:
                if column['type'] == 'reference':
                    self.assertIn(column['target'], targets, (sheet['name'], column))
                if column['type'] == 'enum':
                    values = self.book['options'][column['options']]
                    self.assertGreater(len(values), 0)
                    self.assertEqual(len(values), len(set(values)))

    def test_display_namespaces_and_system_shapes(self):
        prefixes = self.book['entityPrefixes']
        self.assertEqual(set(prefixes), set(self.entities))
        self.assertEqual(len(prefixes), len(set(prefixes.values())))
        self.assertEqual(set(self.book['systemEntities']), set(self.book['systemRecordFieldTypes']))
        for entity, fields in self.book['systemEntities'].items():
            self.assertEqual({f.rstrip('?') for f in fields},
                             set(self.book['systemRecordFieldTypes'][entity]))
        for entity, keys in self.book['compositeUniqueKeys'].items():
            columns = {c['key'] for c in self.entities[entity]['columns']}
            for key in keys:
                self.assertTrue(set(key) <= columns)

    def test_fixture_fields_required_values_and_enum_choices(self):
        for entity, rows in self.workspace['newRows'].items():
            columns = {c['key']: c for c in self.entities[entity]['columns']}
            for row in rows:
                self.assertFalse(set(row) - set(columns), (entity, row))
                for column in columns.values():
                    if column['required']:
                        self.assertIn(column['key'], row, (entity, row['tempKey'], column['key']))
                for key, value in row.items():
                    column = columns[key]
                    if column['type'] == 'enum':
                        self.assertIn(value, self.book['options'][column['options']])
                    elif column['type'] == 'booleanText':
                        self.assertIn(value, ['TRUE', 'FALSE'])
                    elif column['type'] == 'quantity':
                        self.assertIs(type(value), int)
                        self.assertGreaterEqual(value, 0)
                    elif column['type'] in ['money', 'unitMoney', 'percent']:
                        amount = Fraction(value)
                        self.assertGreaterEqual(amount, 0)
                        if column['type'] == 'money':
                            self.assertEqual(amount.denominator, 1)
                        elif column['type'] == 'percent':
                            self.assertLessEqual(amount, 100)

    def test_fixture_references_survive_sorting(self):
        index = {}
        for entity, rows in self.workspace['newRows'].items():
            keys = [r['tempKey'].strip().lower() for r in rows]
            self.assertEqual(len(keys), len(set(keys)), entity)
            index[entity] = set(keys)
        for entity, rows in self.workspace['newRows'].items():
            columns = {c['key']: c for c in self.entities[entity]['columns']}
            # Deliberately traverse in the opposite row order.
            for row in reversed(rows):
                for key, value in row.items():
                    if columns[key]['type'] == 'reference':
                        self.assertTrue(value.startswith('new:'))
                        self.assertIn(value[4:].strip().lower(), index[columns[key]['target']])

    def test_no_fictional_missing_product_is_invented(self):
        sku_names = {r['tempKey'] for r in self.workspace['newRows']['SKU']}
        self.assertIn('月鯨吊飾', sku_names)
        self.assertNotIn('月鯨徽章', sku_names)

    def test_issue_contract_does_not_block_user_business_decisions(self):
        by_code = {i['code']: i for i in self.issues}
        self.assertEqual(len(by_code), len(self.issues))
        for issue in self.issues:
            self.assertEqual(issue['blocksImport'], issue['severity'] == 'error')
        for code in ['CALCULATION_UNKNOWN', 'OPEN_ITEMS', 'DECISION_DIFFERENCE', 'RULE_AMBIGUOUS']:
            self.assertFalse(by_code[code]['blocksImport'])
        for code in ['ID_DUPLICATE', 'FORMULA_NOT_ALLOWED', 'REVISION_STALE', 'STOCK_INSUFFICIENT']:
            self.assertTrue(by_code[code]['blocksImport'])

    def test_workbook_source_financial_fractions(self):
        case = self.case('FIN-01')
        values = case['input']
        costs = [Fraction(v) for v in values['unitCosts']]
        allocations = [Fraction(values['artworkFee']) * c / sum(costs) for c in costs]
        self.assertEqual(allocations, [Fraction(v) for v in case['expected']['allocatedArtwork']])
        per_unit = [a / q for a, q in zip(allocations, values['quantities'])]
        self.assertEqual(per_unit, [Fraction(v) for v in case['expected']['unitArtwork']])
        self.assertEqual([a + c for a, c in zip(per_unit, costs)],
                         [Fraction(v) for v in case['expected']['unitCombined']])
        agreed_total = sum(Fraction(r) * q for r, q in zip(values['agreedUnitRecovery'], values['quantities']))
        self.assertEqual(agreed_total, Fraction(case['expected']['agreedTotal']))
        self.assertEqual(agreed_total - Fraction(values['artworkFee']), Fraction(case['expected']['difference']))

    def test_actual_cost_and_commission_examples(self):
        case = self.case('FIN-02')
        value, expected = case['input'], case['expected']
        unit_print = Fraction(value['actualTotal']) / value['quantity']
        unit_art = Fraction(value['artworkFee']) * 57 / 62 / 30
        self.assertEqual(unit_print, Fraction(expected['actualUnitPrint']))
        self.assertEqual(unit_art, Fraction(expected['unitArtworkStand']))
        self.assertEqual(unit_print + unit_art, Fraction(expected['actualCombinedStand']))
        self.assertEqual(57 + unit_art, Fraction(expected['estimatedCombinedStand']))
        case = self.case('FIN-04')
        revenue = Fraction(case['input']['netRevenue'])
        artwork = Fraction(case['input']['soldArtworkRecovery'])
        commission = (revenue - artwork) * Fraction(case['input']['commissionPercent']) / 100
        self.assertEqual(commission, Fraction(case['expected']['commission']))
        self.assertEqual(revenue - artwork - commission, Fraction(case['expected']['creatorDistribution']))

    def test_synthetic_allocation_and_cash_are_conserved(self):
        for case_id in ['FIN-06', 'FIN-07']:
            case = self.case(case_id)
            self.assertEqual(sum(map(Fraction, case['expected']['amounts'])), Fraction(case['input']['total']))
        case = self.case('FIN-16')
        self.assertEqual(sum(map(Fraction, case['expected']['allocatedDiscount'])), Fraction(case['input']['orderDiscount']))
        self.assertEqual(sum(map(Fraction, case['expected']['finalRevenue'])), Fraction(case['expected']['sum']))
        case = self.case('FIN-24')
        result = case['expected']
        total = sum(Fraction(result[k]) for k in ['creatorCostRecovery', 'creatorProfit', 'organizerArtRecovery', 'organizerCommission'])
        self.assertEqual(total, Fraction(case['input']['netRevenue']))
        self.assertEqual(Fraction(result['creatorCostRecovery']) + Fraction(result['creatorProfit']), Fraction(result['creatorTotal']))

    def test_workflow_stock_and_revenue_numbers(self):
        steps = {s['id']: s for s in self.workspace['operations']}
        total = sum(i['qty'] for i in steps['SCN-01']['items'])
        self.assertEqual(total, steps['SCN-01']['expected']['totalBookQty'])
        self.assertEqual(sum(i['qty'] for i in steps['SCN-02']['items']), steps['SCN-02']['expected']['transferredQty'])
        revenue = Fraction(0)
        for step_id in ['SCN-03', 'SCN-04']:
            step = steps[step_id]
            amount = sum(Fraction(i['unitPrice']) * i['qty'] for i in step['items'])
            revenue += amount
            total -= sum(i['qty'] for i in step['items'])
            self.assertEqual(amount, Fraction(step['expected']['netRevenue']))
            self.assertEqual(total, step['expected']['totalBookQty'])
        revenue -= Fraction(steps['SCN-06']['refundAmount'])
        total += steps['SCN-06']['qty']
        self.assertEqual(revenue, Fraction(steps['SCN-06']['expected']['totalNetRevenue']))
        self.assertEqual(total, steps['SCN-06']['expected']['totalBookQty'])
        # Physical count discrepancy is left visible, not transferred as a fake item.
        self.assertEqual(steps['SCN-08']['expected']['moonCharm'], steps['SCN-07']['countedMoonCharm'])
        self.assertEqual(steps['SCN-08']['expected']['unresolvedBookQtyAtFirstEvent'], 1)

    def test_financial_vector_identity_and_known_error_codes(self):
        ids = [c['id'] for c in self.finances]
        self.assertGreaterEqual(len(ids), 25)
        self.assertEqual(len(ids), len(set(ids)))
        codes = {i['code'] for i in self.issues}
        for case in self.finances:
            self.assertIn(case['origin'], ['provided-workbook', 'confirmed-conversation', 'synthetic'])
            if 'error' in case['expected']:
                self.assertIn(case['expected']['error'], codes)
            for warning in case['expected'].get('warnings', []):
                self.assertIn(warning, codes)


if __name__ == '__main__':
    unittest.main()
