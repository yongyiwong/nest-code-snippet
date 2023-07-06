import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CouponModule } from '../coupon/coupon.module';
import { Location } from '../entities/location.entity';
import { LocationDeliveryHour } from '../entities/location-delivery-hour.entity';
import { LocationHoliday } from '../entities/location-holiday.entity';
import { LocationHour } from '../entities/location-hour.entity';
import { LocationRating } from '../entities/location-rating.entity';
import { HoursService } from './hours/hours.service';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationLogService } from './location-log.service';
import { MapsModule } from '../maps/maps.module';
import { ProductModule } from '../product/product.module';
import { UserModule } from '../user/user.module';
import { MobileCheckInModule } from '../mobile-check-in/mobile-check-in.module';
import { OrganizationModule } from '../organization/organization.module';
import { NotificationService } from '../notification/notification.service';
import { OrderModule } from '../order/order.module';
import { DeliveryTime } from '../entities/delivery-time.entity';
import { DeliveryVanOrders } from '../entities/delivery-van-orders.entity';
import { DriverDeliveryOrder } from '../entities/driver-delivery-order.entity';
import { StoreVanMapping } from '../entities/store-van-mapping.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Location,
      LocationRating,
      LocationHour,
      LocationHoliday,
      LocationDeliveryHour,
      DeliveryTime,
      DeliveryVanOrders,
      DriverDeliveryOrder,
      StoreVanMapping,
    ]),
    ProductModule,
    UserModule,
    MapsModule,
    CouponModule,
    forwardRef(() => OrganizationModule),
    forwardRef(() => OrderModule),
    MobileCheckInModule,
  ],
  controllers: [LocationController],
  providers: [
    LocationLogService,
    NotificationService,
    HoursService,
    LocationService,
  ],
  exports: [LocationService, LocationLogService, HoursService],
})
export class LocationModule {}
