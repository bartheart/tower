import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Transaction extends Model {
  static table = 'transactions';

  @field('user_id') userId!: string;
  @field('plaid_transaction_id') plaidTransactionId!: string;
  @field('account_id') accountId!: string;
  @field('amount') amount!: number;
  @field('merchant_name') merchantName!: string;
  @field('category_l1') categoryL1!: string;
  @field('category_l2') categoryL2!: string;
  @field('date') date!: string;
  @field('pending') pending!: boolean;
}
