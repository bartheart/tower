import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Account extends Model {
  static table = 'accounts';

  @field('plaid_account_id') plaidAccountId!: string;
  @field('plaid_item_id') plaidItemId!: string;
  @field('name') name!: string;
  @field('type') type!: string;
  @field('subtype') subtype!: string;
  @field('current_balance') currentBalance!: number;
  @field('available_balance') availableBalance!: number;
  @field('institution_name') institutionName!: string;
}
