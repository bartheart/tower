import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class PlaidItem extends Model {
  static table = 'plaid_items';

  @field('user_id') userId!: string;
  @field('item_id') itemId!: string;
  @field('access_token') accessToken!: string;
  @field('institution_id') institutionId!: string;
  @field('institution_name') institutionName!: string;
  @field('cursor') cursor!: string;
  @field('last_synced_at') lastSyncedAt!: number | undefined;
}
