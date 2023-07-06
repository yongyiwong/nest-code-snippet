import { EntityManager } from 'typeorm';

import { Injectable } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { LocationLog } from '../entities/location-log.entity';

@Injectable()
export class LocationLogService {
  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  async getLocationLog(
    page: number = 0,
    limit: number = 100,
    order?: string,
  ): Promise<any> {
    const query = this.entityManager
      .createQueryBuilder(LocationLog, 'location_log')
      .select('location_log.id', 'id')
      .addSelect('location.id', 'locationId')
      .addSelect('location.name', 'locationName')
      .addSelect('location_log.status', 'status')
      .addSelect('location_log.message', 'message')
      .addSelect(`location_log.created AT TIME ZONE 'UTC'`, 'created')
      .addSelect(`location_log.modified AT TIME ZONE 'UTC'`, 'modified')
      .addSelect('location_log.product_count', 'productLogCount')
      .leftJoin('location_log.location', 'location')
      .groupBy('location_log.id, location.id');
    const count = await query.getCount();

    query.limit(limit).offset(page * limit);
    if (order) {
      query.orderBy(order);
    } else {
      query.orderBy('location_log.modified', 'DESC');
    }
    return Promise.resolve([await query.getRawMany(), count]);
  }
}
