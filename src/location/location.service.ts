import { OrderService } from './../order/order.service';
import { S3, SNS } from 'aws-sdk';
import { format } from 'date-fns';
import * as log from 'fancy-log';
import * as path from 'path';
import * as s3Proxy from 's3-proxy';
import { isEmpty, first, defaults } from 'lodash';
import { Repository, UpdateResult, getConnection } from 'typeorm';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@sierralabs/nest-utils';

import { isNonProduction } from '../app.service';
import { LocationHoliday } from '../entities/location-holiday.entity';
import { LocationRating } from '../entities/location-rating.entity';
import { Location } from '../entities/location.entity';
import { MobileCheckIn } from '../entities/mobile-check-in.entity';
import { Organization } from '../entities/organization.entity';
import { UserLocation } from '../entities/user-location.entity';
import { User } from '../entities/user.entity';
import { GDExpectedException } from '../gd-expected.exception';
import { MapsService } from '../maps/maps.service';
import { MobileCheckInDto } from '../mobile-check-in/mobile-check-in.dto';
import { MobileCheckInService } from '../mobile-check-in/mobile-check-in.service';
import { MailerNotification } from '../notification/notification.service';
import { OrganizationService } from '../organization/organization.service';
import { RoleEnum } from '../roles/roles.enum';
import { UserLocationService } from '../user-location/user-location.service';
import { LocationPhotoPresignDto } from './dto/location-photo-presign.dto';
import {
  LocationSearchDto,
  LocationActiveDealsDto,
} from './dto/location-search.dto';
import { HoursService } from './hours/hours.service';
import { LocationExceptions } from './location.exceptions';
import { UserService } from '../user';
import { OrganizationExceptions } from '../organization/organization.exceptions';
import {
  SearchParams,
  DEFAULT_PARAMS,
} from '../common/search-params.interface';
import { SearchCountMapping } from '../common/search-count.dto';
import { empty } from 'rxjs';
import { PosInfo } from '../synchronize/mjfreeway/mjfreeway-order.service';
import { DeliveryTime } from '../entities/delivery-time.entity';
import { DeliveryVanOrders } from '../entities/delivery-van-orders.entity';
import { DriverDeliveryOrder } from '../entities/driver-delivery-order.entity';
import { StoreVanMapping } from '../entities/store-van-mapping.entity';

export const SRID = 4326; // GIS spatial ref for meters, or WGS84
@Injectable()
export class LocationService {
  s3client: S3;
  sns: SNS;

  /**
   * computed entity properties, used for order/search
   * used by getRaw* methods
   */
  private readonly locationSelectColumns = [
    'location.id as id',
    'location.pos_id as "posId"',
    'location.thumbnail as thumbnail',
    'location.site_photo as "sitePhoto"',
    'location.name as "name"',
    'location.description as "description"',
    'location.longLat as "longLat"',
    'location.timezone as "timezone"',
    'location.addressLine1 as "addressLine1"',
    'location.addressLine2 as "addressLine2"',
    'location.city as "city"',
    'location.postalCode as "postalCode"',
    'location.phoneNumber as "phoneNumber"',
    'location.deleted as "deleted"',
    'location.isDeliveryAvailable as "isDeliveryAvailable"',
    'location.deliveryMileRadius as "deliveryMileRadius"',
    'location.delivery_fee as "deliveryFee"',
    'location.delivery_fee_patient_percentage as "deliveryFeePatientPercentage"',
    'location.created as "created"',
    'location.modified as "modified"',
    'location.url as "url"',
    'location.priority as priority',
    'location.allowOffHours as "allowOffHours"',
    'location.flower_limit as "flower_limit"',
    'location.message as "message"',
  ];

  /**
   * computed NON-entity properties
   * used by getRaw* methods
   */
  private readonly locationComputedColumns = [
    'location.id as "locationId"',
    'state.id as "stateId"',
    'state.abbreviation as "state"',
    '(ROUND(AVG(rating.rating)::numeric * 2) / 2)::float as rating',
    'COUNT(rating.id) as "ratingCount"',
  ];

  constructor(
    @InjectRepository(Location)
    protected readonly locationRepository: Repository<Location>,
    // @InjectRepository(dispensary_followers)
    // protected readonly dispensary_followersRepository: Repository<dispensary_followers>,
    @InjectRepository(DriverDeliveryOrder)
    protected readonly driverDeliveryOrderRepository: Repository<
      DriverDeliveryOrder
    >,
    @InjectRepository(StoreVanMapping)
    protected readonly storeVanMappingRepository: Repository<StoreVanMapping>,
    @InjectRepository(Organization)
    protected readonly organizationRepository: Repository<Organization>,
    @InjectRepository(LocationRating)
    protected readonly ratingRepository: Repository<LocationRating>,
    @InjectRepository(LocationHoliday)
    protected readonly holidayRepository: Repository<LocationHoliday>,
    @InjectRepository(DeliveryTime)
    protected readonly deliveryTimeRepository: Repository<DeliveryTime>,
    @InjectRepository(DeliveryVanOrders)
    protected readonly deliveryVanOrdersRepository: Repository<
      DeliveryVanOrders
    >,
    protected readonly mapsService: MapsService,
    protected readonly configService: ConfigService,
    protected readonly hoursService: HoursService,
    protected readonly mobileCheckInService: MobileCheckInService,
    protected readonly organizationService: OrganizationService,
    protected readonly userService: UserService,
    protected readonly userLocationService: UserLocationService,
    private readonly orderService: OrderService,
  ) {
    const config = configService.get('storage.aws.s3');
    config.signatureVersion = 'v4'; // allow for browser upload
    this.s3client = new S3(config);

    // SNS Configuration
    const snsOptions: SNS.ClientConfiguration = { apiVersion: '2010-03-31' };
    if (isNonProduction()) {
      // ! Allow specifying localstack SNS to test without using real AWS.
      const endpoint = this.configService.get('notification.aws.sns.endpoint');
      if (!!endpoint) {
        snsOptions.endpoint = endpoint;
      }
    }
    this.sns = new SNS(snsOptions);
  }

  public async findWithFilter(
    searchParams: SearchParams,
  ): Promise<[LocationSearchDto[], number]> {
    try {
      const {
        search,
        minLat,
        minLong,
        maxLat,
        maxLong,
        page,
        limit,
        order,
        organizationId,
        startFromLat,
        startFromLong,
        assignedUserId,
        couponId,
        includeDeleted,
        deliveryAvailableOnly,
        mileRadius,
      } = defaults(searchParams, DEFAULT_PARAMS);

      const filter = '%' + (search || '') + '%';
      const offset = page * limit;

      /// Select columns
      const query = this.locationRepository
        .createQueryBuilder('location')
        .select('location') // entity properties, so that we can use getMany() to have object nesting of leftJoins instead of getRaw*()
        .addSelect(this.locationSelectColumns) // reuse computed entities so that search will work with left joins (prevent unambiguos names)
        .addSelect(this.locationComputedColumns) // computed non-entity properties
        .where(
          `( location.name ILIKE :filter OR
          location.city ILIKE :filter OR
          location.addressLine1 ILIKE :filter OR
          location.addressLine2 ILIKE :filter)`,
          { filter },
        )
        .leftJoin('location.state', 'state')
        .leftJoin('location.ratings', 'rating', 'rating.deleted = false')
        .leftJoin('location.coupons', 'coupons', 'coupons.deleted = false')
        .leftJoinAndSelect('location.organization', 'organization');

      /// Computed distance column
      let distanceClause = 'NULL';
      if (startFromLat || startFromLong) {
        const longLat = { startFromLat, startFromLong };
        GDExpectedException.try(
          LocationExceptions.invalidStartingLatLong,
          longLat,
        );

        // gets the distance in meters
        const distanceQuery = `ST_DistanceSphere(
          ST_SetSrid(ST_MakePoint(long_lat[0], long_lat[1]), ${SRID}),
          ST_SetSrid(ST_MakePoint(${startFromLong}, ${startFromLat}), ${SRID})
        )`;

        // convert meters to kilometers by dividing it by 1000.0
        distanceClause = `CASE WHEN long_lat IS NULL THEN NULL ELSE (${distanceQuery} / 1000.0) END`;

        if (mileRadius) {
          // convert meters to miles by dividing it by 1609.344
          query.andWhere(
            `CASE WHEN long_lat IS NULL THEN NULL ELSE (${distanceQuery} / 1609.344) <= :mileRadius END`,
            {
              mileRadius,
            },
          );
        }
      }
      query.addSelect(distanceClause, 'distance');

      /// Where clauses
      if (organizationId) {
        query.andWhere('location.organization_id = :organizationId', {
          organizationId,
        });
      }
      if (minLat && minLong && maxLat && maxLong) {
        query.andWhere(
          'ST_MakePoint(long_lat[0], long_lat[1], :SRID) && ST_MakeEnvelope(:minLong, :minLat, :maxLong, :maxLat, :SRID)',
          { minLong, minLat, maxLong, maxLat, SRID },
        );
      }
      if (assignedUserId) {
        query.andWhere(queryBuilder => {
          const subQuery = queryBuilder
            .subQuery()
            .select(['userLocation.location_id'])
            .from(UserLocation, 'userLocation')
            .where(
              'userLocation.user_id = :assignedUserId AND userLocation.deleted = false',
              { assignedUserId },
            )
            .getQuery();
          return 'location.id IN ' + subQuery;
        });
      }
      if (couponId) {
        query.andWhere('coupons.coupon_id = :couponId', {
          couponId,
        });
      }
      if (!includeDeleted) {
        query.andWhere('location.deleted = false');
      }
      if (deliveryAvailableOnly) {
        query.andWhere('location.isDeliveryAvailable = true');
      }
      /// Group by, Pagination, Subqueries
      query.groupBy('location.id, state.id, organization.id');
      query.limit(limit).offset(offset);

      if (order) {
        const key = Object.keys(order)[0];
        order['location.' + key] = order[key];
        delete order[key];
        query.orderBy(order);
      } else {
        query.orderBy({
          priority: 'ASC',
          distance: {
            order: 'ASC',
            nulls: 'NULLS LAST',
          },
        });
        if (!(minLat && minLong && maxLat && maxLong)) {
          query.addOrderBy('location.name', 'ASC', 'NULLS LAST');
        }
      }

      const count = await query.getCount();
      const rawAndEntities = await query.getRawAndEntities(); // plain entity columns, computed columns
      const finalEntities = await this.mapRawAndSubqueriesToDto(rawAndEntities); // map to one list + complex subqueries
      return [finalEntities, count];
    } catch (error) {
      throw error;
    }
  }

  public async findById(
    id: number,
    includeDeleted?: boolean,
    selectNoficationMobileNumbers?: boolean,
  ): Promise<LocationSearchDto> {
    if (!id) throw new BadRequestException('id not provided');
    try {
      const query = this.locationRepository
        .createQueryBuilder('location')
        .leftJoin('location.state', 'state')
        .leftJoin('location.ratings', 'rating', 'rating.deleted = false')
        .leftJoin('location.organization', 'organization')
        .where(`location.id = :id`, { id })
        .select(this.locationSelectColumns)
        .addSelect(this.locationComputedColumns)
        .addSelect(['location.organization as "organization"'])
        .groupBy('location.id, state.id');

      if (!includeDeleted) {
        query.andWhere('location.deleted = false');
      }

      if (selectNoficationMobileNumbers) {
        query.addSelect([
          'location.notificationMobileNumber as "notificationMobileNumber"',
          'location.notificationDeliveryMobileNumber as "notificationDeliveryMobileNumber"',
        ]);
      }

      const location = await query.getRawOne();

      /* Relations
      using separate query for embedding relation entities since does not work with
      left join methods or getRawOne
    */
      if (location) {
        location.organization = await this.organizationRepository.findOne(
          location.organization,
        );
        location.holidays = await this.getLocationHolidays(location);
        location.hours = await this.hoursService.getLocationHours(location.id);
        location.hoursToday = this.hoursService.getHoursToday(location);

        location.deliveryHours = await this.hoursService.getLocationDeliveryHours(
          location.id,
        );
        location.deliveryHoursToday = this.hoursService.getLocationDeliveryHoursToday(
          location,
          'hh:mm A',
          'hh:mm A',
        );
      }
      return Promise.resolve(location as LocationSearchDto);
    } catch (error) {
      throw error;
    }
  }

  public async create(
    location: Location,
    isAutoAssignEnabled?: boolean,
  ): Promise<Location> {
    this.validateLocationLongLat(location);
    delete location.id;
    try {
      location = await this.addTimeZoneIfNeeded(location);
    } catch (error) {
      throw new HttpException(
        'Failed to get location timezone from Google. See logs.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    let locationResult;
    try {
      locationResult = await this.locationRepository.save(location);

      if (isAutoAssignEnabled && location.organization) {
        const locationResultId = locationResult.id;
        const organizationId = location.organization.id;
        await this.assignOrgUsersToLocation(
          organizationId,
          locationResultId,
          location.createdBy,
        );
      }
    } catch (error) {
      throw error;
    }

    return locationResult;
  }

  public async saveLocationDeliveryTimeslots(
    day: string,
    time: string,
    locationId: number,
    maxOrdersHour: number,
    dayNum: number,
  ): Promise<UpdateResult> {
    let result = null;
    try {
      const followersResult = new DeliveryTime();
      followersResult.storeId = locationId;
      followersResult.day = day;
      followersResult.timeSlot = time;
      followersResult.maxOrdersHour = maxOrdersHour;
      followersResult.dayNum = dayNum;

      result = await this.deliveryTimeRepository.save(followersResult);

      return;
      // this.validateLocationDeliveryHours(deliveryHours);
      // return Promise.all(
      //   deliveryHours.map(async hour => {
      //     const hourData = await this.getLocationDeliveryHour(
      //       hour.location.id,
      //       hour.dayOfWeek,
      //     );
      //     hour.startTime = hour.startTime || null;
      //     hour.endTime = hour.endTime || null;
      //     if (hourData) {
      //       hour.id = hourData.id;
      //       return this.updateLocationDeliveryHour(hour);
      //     } else {
      //       return this.createLocationDeliveryHour(hour);
      //     }
      //   }),
      // );
    } catch (error) {
      throw error;
    }
  }

  public async saveDeliveryVanTimeslots(
    driverId: number,
    date: string,
    timeSlot: string,
    maxOrdersPerHour: number,
    counter: number,
    locationId: number,
  ) {
    let result = null;
    try {
      const followersResult = new DeliveryVanOrders();
      followersResult.driverId = driverId;
      followersResult.date = date;
      followersResult.timeSlot = timeSlot;
      followersResult.maxOrdersPerHour = maxOrdersPerHour;
      followersResult.counter = counter;
      followersResult.locationId = locationId;

      result = await this.deliveryVanOrdersRepository.save(followersResult);

      return result;
      // this.validateLocationDeliveryHours(deliveryHours);
      // return Promise.all(
      //   deliveryHours.map(async hour => {
      //     const hourData = await this.getLocationDeliveryHour(
      //       hour.location.id,
      //       hour.dayOfWeek,
      //     );
      //     hour.startTime = hour.startTime || null;
      //     hour.endTime = hour.endTime || null;
      //     if (hourData) {
      //       hour.id = hourData.id;
      //       return this.updateLocationDeliveryHour(hour);
      //     } else {
      //       return this.createLocationDeliveryHour(hour);
      //     }
      //   }),
      // );
    } catch (error) {
      throw error;
    }
  }

  // public async UpdateMessage(
  //   id: number,
  //   locationid: number, dispensary_message: string
  // ): Promise<UpdateResult> {
  //   if (!locationid) return Promise.reject(null);
  //   let result = null;
  //   try {
  //     const update_chat_box_message = {
  //       dispensary_message: dispensary_message
  //     };
  //     result = this.chatBoxMessageRepository
  //       .createQueryBuilder()
  //       .update(chat_box_messages)
  //       .set(update_chat_box_message)
  //       .where('locationid = :locationid and id=:id', { locationid, id })
  //       .execute();
  //     // cart = await query.getManyAndCount();
  //   } catch (error) {
  //     throw error;
  //   }
  //   return new Promise<UpdateResult>(resolve => { resolve(result) });
  // }

  public async updateLocationDeliveryTimeslots(
    day: string,
    timeSlot: string,
    locationId: number,
    maxOrdersHour: number,
  ): Promise<UpdateResult> {
    let result = null;
    try {
      const updateLocationDeliveryTime = {
        maxOrdersHour,
      };

      this.deliveryTimeRepository
        .createQueryBuilder()
        .delete()
        .where(
          'store_id = :locationId and day=:day and delivery_time.time_slot=:timeSlot ',
          { locationId, day, timeSlot },
        )
        .execute();

      result = this.deliveryTimeRepository
        .createQueryBuilder()
        .update(DeliveryTime)
        .set(updateLocationDeliveryTime)
        .where(
          'store_id = :locationId and day=:day and delivery_time.time_slot=:timeSlot ',
          { locationId, day, timeSlot },
        )
        .execute();
    } catch (error) {
      throw error;
    }
    return new Promise<UpdateResult>(resolve => {
      resolve(result);
    });
  }

  public async updateDeliveryVanTimeslots(
    driverId: number,
    date: string,
    timeSlot: string,
    counter: number,
    locationId: number,
  ) {
    let result = null;
    try {
      const updateDeliveryVanOrders = {
        counter,
      };

      result = await this.deliveryVanOrdersRepository
        .createQueryBuilder()
        .update(DeliveryVanOrders)
        .set(updateDeliveryVanOrders)
        .where(
          'driver_id = :driverId and time_slot=:timeSlot and date=:date and locationid=:locationId',
          { driverId, timeSlot, date, locationId },
        )
        .execute();
      return result;
    } catch (error) {
      throw error;
    }
  }

  public async getDeliveryTimeByLocationDay(
    locationId: number,
    day: string,
    timeSlot: string,
  ): Promise<DeliveryTime> {
    let cart: any = null;
    try {
      const query = this.deliveryTimeRepository
        .createQueryBuilder('delivery_time')
        .where(
          'delivery_time.store_id = :locationId and  delivery_time.day = :day and delivery_time.time_slot=:timeSlot ',
          {
            locationId,
            day,
            timeSlot,
          },
        );

      cart = await query.getManyAndCount();
    } catch (error) {
      throw error;
    }

    return new Promise<DeliveryTime>(resolve => {
      resolve(cart);
    });
  }

  public async sendOrderDeliverySMS(
    mobileNumber: string,
    message: string,
  ): Promise<string> {
    try {
      // Create publish parameters
      const params = {
        Message: message /* required */,
        PhoneNumber: mobileNumber,
      };
      // Create promise and SNS service object
      const publishTextPromise = this.sns.publish(params).promise();

      // Handle promise's fulfilled/rejected states
      publishTextPromise.then(data => {}).catch(err => {});
    } catch (error) {
      throw error;
    }
    return 'success';
  }

  public async getTimeslotsByDayLocation(
    locationId: number,
    day: string,
  ): Promise<DeliveryTime> {
    let cart: any = null;
    try {
      const query = this.deliveryTimeRepository
        .createQueryBuilder('delivery_time')
        .where(
          'delivery_time.store_id = :locationId and  delivery_time.day_num = :day',
          {
            locationId,
            day,
          },
        );

      cart = await query.getManyAndCount();
    } catch (error) {
      throw error;
    }
    return new Promise<DeliveryTime>(resolve => {
      resolve(cart);
    });
  }

  public async getDriverDeliveryOrders(
    driverId: number,
    locationId: number,
    timeSlot: string,
    date: string,
  ): Promise<DriverDeliveryOrder> {
    let cart: any = null;
    try {
      const query = this.driverDeliveryOrderRepository
        .createQueryBuilder('driver_delivery_order')
        .where(
          `driver_delivery_order.store_id = :locationId and driver_delivery_order.driver_id = :driverId and
           driver_delivery_order.time_slot=:timeSlot and driver_delivery_order.date=:date`,
          {
            locationId,
            driverId,
            timeSlot,
            date,
          },
        );

      cart = await query.getManyAndCount();

      return new Promise<DriverDeliveryOrder>((resolve, reject) => {
        resolve(cart);
      });
    } catch (error) {
      throw error;
    }
  }

  public async getDriverDeliveryOrdersByDriver(
    driverId: number,
    date: string,
  ): Promise<DriverDeliveryOrder> {
    let cart: any = null;
    try {
      const query = this.driverDeliveryOrderRepository
        .createQueryBuilder('driver_delivery_order')
        .where(
          ' driver_delivery_order.driver_id = :driverId and driver_delivery_order.date=:date ',
          {
            driverId,
            date,
          },
        );

      cart = await query.getManyAndCount();

      return new Promise<DriverDeliveryOrder>(resolve => {
        resolve(cart);
      });
    } catch (error) {
      throw error;
    }
  }

  public async saveDriverDeliveryOrders(
    driverId: number,
    locationId: number,
    timeSlot: string,
    date: string,
    orderId: number,
  ) {
    let result = null;
    try {
      const followersResult = new DriverDeliveryOrder();
      followersResult.storeId = locationId;
      followersResult.orderId = orderId;
      followersResult.driverId = driverId;
      followersResult.timeSlot = timeSlot;
      followersResult.date = date;

      result = await this.driverDeliveryOrderRepository.save(followersResult);

      return result;
    } catch (error) {
      throw error;
    }
  }

  public async getDriverId(locationId: number): Promise<StoreVanMapping> {
    let cart: any = null;
    try {
      const query = this.storeVanMappingRepository
        .createQueryBuilder('store_van_mapping')
        .where('store_van_mapping.store_id = :locationId', {
          locationId,
        });

      cart = await query.getManyAndCount();

      return new Promise<StoreVanMapping>(resolve => {
        resolve(cart);
      });
    } catch (error) {
      throw error;
    }
  }

  public async getDeliveryVanOrders(
    driverId: number,
    locationId: number,
    timeSlot: string,
    date: string,
  ) {
    let cart: any = null;
    try {
      const query = this.deliveryVanOrdersRepository
        .createQueryBuilder('delivery_van_orders')
        .where(
          `delivery_van_orders.locationid = :locationId and delivery_van_orders.driver_id = :driverId and
           delivery_van_orders.time_slot=:timeSlot and delivery_van_orders.date=:date`,
          {
            locationId,
            driverId,
            timeSlot,
            date,
          },
        );
      cart = await query.getManyAndCount();

      const user = await this.deliveryVanOrdersRepository
        .createQueryBuilder('van_orders')
        .select('counter')
        .getManyAndCount();

      return user;
    } catch (error) {
      throw error;
    }
  }

  public async getDeliveryVanOrdersCount(
    driverId: number,
    locationId: number,
    timeSlot: string,
    date: string,
  ) {
    let cart: any = null;
    try {
      const query = this.deliveryVanOrdersRepository
        .createQueryBuilder('delivery_van_orders')
        .where(
          `delivery_van_orders.locationid = :locationId and delivery_van_orders.driver_id = :driverId and
           delivery_van_orders.time_slot=:timeSlot and delivery_van_orders.date=:date`,
          {
            locationId,
            driverId,
            timeSlot,
            date,
          },
        );

      cart = await query.getCount();
      return cart;
    } catch (error) {
      throw error;
    }
  }

  public async getDeliveryTimeByLocation(
    locationId: number,
  ): Promise<DeliveryTime> {
    let cart: any = null;
    try {
      const query = this.deliveryTimeRepository
        .createQueryBuilder('delivery_time')
        .where('delivery_time.store_id = :locationId ', {
          locationId,
        });

      cart = await query.getManyAndCount();
    } catch (error) {
      throw error;
    }
    return new Promise<DeliveryTime>(resolve => {
      resolve(cart);
    });
  }

  public async manageOrganizationSiteAdmins(
    organizationId: number,
    organizationSiteAdminIds: number[],
    modifiedBy: number,
  ): Promise<void> {
    try {
      const [organizationLocations] = await this.findWithFilter({
        organizationId,
      });
      GDExpectedException.try(
        OrganizationExceptions.siteAdminAssignmentRestricted,
        organizationLocations,
      );

      const [
        organizationSiteAdmins,
      ] = await this.userService.getAssignedOrganizationUsers(
        organizationId,
        RoleEnum.SiteAdmin,
      );

      await this.userLocationService.removeNonAssignedUserLocations(modifiedBy);

      // unassign unselected siteadmins
      await this.unassignRemovedSiteAdmins(
        organizationSiteAdmins,
        organizationSiteAdminIds,
        organizationLocations,
        modifiedBy,
      );

      // assign new site admins to location
      await this.assignNewSiteAdmins(
        organizationId,
        organizationSiteAdminIds,
        organizationLocations,
        modifiedBy,
      );
    } catch (error) {
      throw error;
    }
  }

  private async unassignRemovedSiteAdmins(
    currOrganizationSiteAdmins: User[],
    organizationSiteAdminIds: number[],
    organizationLocations: LocationSearchDto[],
    modifiedBy: number,
  ): Promise<UpdateResult[]> {
    try {
      const unassignedLocations: Promise<UpdateResult>[] = [];
      for (const siteAdmin of currOrganizationSiteAdmins) {
        const isSelected = organizationSiteAdminIds.find(
          id => id === siteAdmin.id,
        );

        if (!isSelected) {
          for (const location of organizationLocations) {
            const currLocationId = location.id;
            const locationUsers = await this.userLocationService.getAllByUserId(
              siteAdmin.id,
            );
            const currUserLocation = locationUsers.find(
              loc => loc.location && loc.location.id === currLocationId,
            );
            if (currUserLocation) {
              unassignedLocations.push(
                this.userLocationService.delete(currUserLocation, modifiedBy),
              );
            }
          }
        }
      }
      return Promise.all(unassignedLocations);
    } catch (error) {
      throw error;
    }
  }

  private async assignNewSiteAdmins(
    organizationId: number,
    organizationSiteAdminIds: number[],
    organizationLocations: LocationSearchDto[],
    modifiedBy: number,
  ): Promise<UserLocation[]> {
    try {
      const assignedLocations: Promise<UserLocation>[] = [];
      for (const siteAdminId of organizationSiteAdminIds) {
        const locationUsers = await this.userLocationService.getAllByUserId(
          siteAdminId,
        );
        const existingLocation = locationUsers.filter(userLocation => {
          const location = userLocation.location;
          const organization = location ? location.organization : null;
          if (organization) {
            return organization.id === organizationId;
          }
        });
        if (isEmpty(existingLocation)) {
          organizationLocations.forEach(location => {
            const locationId = location.id;
            assignedLocations.push(
              this.userLocationService.create(
                siteAdminId,
                locationId,
                modifiedBy,
              ),
            );
          });
        }
      }
      return Promise.all(assignedLocations);
    } catch (error) {
      throw error;
    }
  }

  public async assignOrgUsersToLocation(
    organizationId: number,
    locationId: number,
    modifiedBy: number,
  ): Promise<void> {
    try {
      const [
        organizationSiteAdmins,
      ] = await this.userService.getAssignedOrganizationUsers(
        organizationId,
        RoleEnum.SiteAdmin,
      );
      const assignedLocations: Promise<UserLocation>[] = [];
      organizationSiteAdmins.forEach(user =>
        assignedLocations.push(
          this.userLocationService.create(user.id, locationId, modifiedBy),
        ),
      );
      await Promise.all(assignedLocations);
    } catch (error) {
      throw error;
    }
  }

  public async update(location: Location): Promise<Location> {
    try {
      const INCLUDE_DELETED = true;
      const locationId = location.id;
      this.validateLocationLongLat(location);
      delete location.createdBy;
      location = await this.addTimeZoneIfNeeded(location);
      const prevLocationResult = await this.findById(
        location.id,
        INCLUDE_DELETED,
      );
      const prevOrganization = prevLocationResult.organization;
      const prevOrganizationId = prevOrganization && prevOrganization.id;

      const currentOrganization = location.organization;
      const locationResult = await this.locationRepository.save(location);

      if (
        currentOrganization &&
        currentOrganization.id !== prevOrganizationId
      ) {
        const currentOrganizationId = currentOrganization.id;
        await this.assignOrgUsersToLocation(
          currentOrganizationId,
          locationId,
          location.modifiedBy,
        );
      }
      return locationResult;
    } catch (error) {
      throw error;
    }
  }

  public async remove(id: number, modifiedBy: number): Promise<UpdateResult> {
    return this.locationRepository.update(
      { id },
      { deleted: true, modifiedBy },
    );
  }

  public async createReview(
    rating: LocationRating,
    disableInterval: boolean = false,
  ): Promise<LocationRating> {
    const userId = rating.user.id;
    const locationId = rating.location.id;
    delete rating.id;
    try {
      if (!disableInterval) {
        const query = this.ratingRepository
          .createQueryBuilder('review')
          .where('review.user_id = :userId', { userId })
          .andWhere('review.location_id = :locationId', { locationId })
          .andWhere(`review.created > NOW() - INTERVAL '30' DAY`);
        const count = await query.getCount();
        // check if already reviewed last 30 days.
        GDExpectedException.try(LocationExceptions.addReviewSpam, count);
      }
      return this.ratingRepository.save(rating);
    } catch (error) {
      throw error;
    }
  }

  public async updateReview(rating: LocationRating): Promise<LocationRating> {
    delete rating.createdBy;
    try {
      return this.ratingRepository.save(rating);
    } catch (error) {
      throw error;
    }
  }

  public async getReview(
    locationdId: number,
    reviewId: number,
  ): Promise<LocationRating> {
    try {
      const review = await this.ratingRepository
        .createQueryBuilder('review')
        .select()
        .addSelect(['user.id', 'user.firstName', 'user.lastName'])
        .leftJoin('review.user', 'user')
        .leftJoinAndSelect('review.location', 'location')
        .where('review.id = :reviewId', { reviewId })
        .andWhere('review.location_id = :locationdId', { locationdId })
        .getOne();
      GDExpectedException.try(LocationExceptions.reviewNotFound, review);
      return review;
    } catch (error) {
      throw error;
    }
  }

  public async getReviews(
    locationId: number,
    search?: string,
    page: number = 0,
    limit: number = 100,
    order?: string,
    includeDeleted?: boolean,
  ): Promise<[LocationRating[], number]> {
    const filter = '%' + (search || '') + '%';
    const offset = page * limit;

    try {
      const query = this.ratingRepository
        .createQueryBuilder('review')
        .select()
        .addSelect(['user.id', 'user.firstName', 'user.lastName'])
        .leftJoin('review.user', 'user')
        .where('review.location_id = :locationId', {
          locationId,
        })
        .orderBy('review.created', 'DESC')
        .take(limit)
        .skip(offset);

      if (search) {
        query.andWhere('review.review ILIKE :filter', { filter });
      }

      if (!includeDeleted) {
        query.andWhere('review.deleted = false');
      }

      if (order) {
        const key = Object.keys(order)[0];
        order['review.' + key] = order[key];
        delete order[key];
        query.orderBy(order);
      }

      return query.getManyAndCount();
    } catch (error) {
      throw error;
    }
  }

  public composeReportReviewEmail(
    review: LocationRating,
    sendTo: User,
    reportedBy: User,
    locale: string = 'en-US',
  ): MailerNotification {
    const DATE_FORMAT = 'MMM DD YYYY hh:mm a';
    const fromAddress = this.configService.get('email.from'); // official app email address
    if (!fromAddress) {
      log.error(
        'Error: no app email found in configuration. Please check your "email.from" config.',
      );
    }
    const localedEmailSubject = {
      'en-US': 'GreenDirect: Report Review',
      'es-PR': 'GreenDirect: Informe de revisión',
    };
    const locationId = review.location ? review.location.id : null;
    const reporter = [reportedBy.lastName, reportedBy.firstName].join(', ');
    const poster = [review.user.lastName, review.user.firstName].join(', ');
    const posterId = review.user ? review.user.id : null;
    const datePosted = format(review.created, DATE_FORMAT);

    const email: MailerNotification = {
      subject: localedEmailSubject[locale],
      from: fromAddress,
      to: `${[sendTo.firstName, sendTo.lastName].join(' ')} <${sendTo.email}>`,
      template: 'report-review',
      context: {
        locationId,
        review,
        reporter,
        poster,
        posterId,
        datePosted,
      },
    };
    return email;
  }

  validateLocationLongLat(location: Location) {
    try {
      if (location.longLat) {
        GDExpectedException.try(
          LocationExceptions.invalidCoordinates,
          location.longLat,
        );
      }
    } catch (error) {
      throw error;
    }
  }

  public async getLocationHolidays(location: Location) {
    return await this.holidayRepository.find({
      where: { location: location.id },
    });
  }

  /**
   * returns DTO array combining entity and the computed Select'ed columns
   * @param {entites, raw} - destructured return value of QueryBuilder.getRawAndEntities()
   */
  private async mapRawAndSubqueriesToDto({
    entities,
    raw,
  }: {
    entities: Location[];
    raw: any[];
  }) {
    const mappedDtos: LocationSearchDto[] = await Promise.all(
      entities.map(async location => {
        // computed columns
        location.hours = await this.hoursService.getLocationHours(location.id);
        location.deliveryHours = await this.hoursService.getLocationDeliveryHours(
          location.id,
        );
        const { state, stateId, rating, ratingCount, distance } = raw.find(
          r => r.locationId === location.id,
        ) as LocationSearchDto;
        const dto: LocationSearchDto = {
          ...location,
          state,
          stateId,
          rating,
          ratingCount,
          distance,
          hoursToday: this.hoursService.getHoursToday(location),
          deliveryHoursToday: this.hoursService.getLocationDeliveryHoursToday(
            location,
            'hh:mm A',
            'hh:mm A',
          ),
        };
        return dto;
      }),
    );
    return new Promise<LocationSearchDto[]>(resolve => resolve(mappedDtos));
  }

  private async addTimeZoneIfNeeded(location) {
    if (location && location.longLat && !location.timezone) {
      const { longLat } = location; //  longLat enters as string "(x,y)", not object {x,y}
      let long = null;
      let lat = null;
      if (longLat.x && longLat.y) {
        long = longLat.x;
        lat = longLat.y;
      } else if (typeof longLat === 'string' && longLat.length) {
        const xy = longLat.substring(1, longLat.length - 2); // remove parentheses from "(x,y)"
        long = +xy.split(',')[0];
        lat = +xy.split(',')[1];
      }
      if (long && lat) {
        location.timezone = await this.mapsService.getTimezone(lat, long);
      }
    }
    return location;
  }

  public async createPresignedPost(
    presignDto: LocationPhotoPresignDto,
    expiration: number = 3600,
  ): Promise<any> {
    const timestamp = format(new Date(), 'YYYYMMDDHHmmss');
    let fileKey = `${presignDto.locationId}_${presignDto.type}_`;
    fileKey += timestamp + path.extname(presignDto.name);
    const config = this.configService.get('storage.aws.s3');
    const endpoint = this.configService.get('storage.endpoint');
    const params = {
      Bucket: config.bucket,
      Key: 'locations/' + fileKey,
      Expires: expiration,
    };
    return {
      destinationUrl: `${endpoint}/api/locations/photo/file/${fileKey}`,
      signedUrl: this.s3client.getSignedUrl('putObject', params),
    };
  }

  public proxyFile(fileKey: string, request, response, next) {
    request.originalUrl = '/locations/' + fileKey;
    const options = {
      ...this.configService.get('storage.aws.s3'),
    };
    s3Proxy(options)(request, response, error => {
      if (error && error.status === 404) {
        response.type('json');
        return next(new NotFoundException());
      }
      next(error);
    });
  }

  public async getNearestLocation(
    organizationPosId: number,
    startFromLat: number,
    startFromLong: number,
  ): Promise<LocationSearchDto> {
    try {
      GDExpectedException.try(LocationExceptions.longLatRequired, {
        startFromLong,
        startFromLat,
      });
      const organization: Organization = await this.organizationService.findByPosId(
        organizationPosId,
      );
      const organizationId = organization && organization.id;

      const mileRadius = 0.5;
      const locations: [
        LocationSearchDto[],
        number,
      ] = await this.findWithFilter({
        limit: 1,
        organizationId,
        startFromLat,
        startFromLong,
        mileRadius,
      });

      const nearestLocation: LocationSearchDto = first(locations[0]);
      GDExpectedException.try(
        LocationExceptions.nearestLocationNotFound,
        nearestLocation,
      );
      return nearestLocation;
    } catch (error) {
      throw error;
    }
  }

  public async checkIn(
    mobileCheckInDto: MobileCheckInDto,
  ): Promise<MobileCheckIn> {
    const { mobileNumber, locationId } = mobileCheckInDto;

    try {
      await this.validateCheckIn(mobileNumber, locationId);
      const checkin = await this.mobileCheckInService.checkIn(
        locationId,
        mobileNumber,
      );

      // Check if existing user from mobile number
      const user: User = await this.userService.findByMobileNumber(
        mobileNumber,
      );
      if (user) {
        await this.mobileCheckInService.claimReward(user, mobileNumber);
      }
      await this.mobileCheckInService.sendSmsConfirmation(checkin, !user);

      const updatedCheckin = await this.mobileCheckInService.getLatestCheckIn(
        mobileNumber,
      );
      return updatedCheckin;
    } catch (error) {
      throw error;
    }
  }

  public async validateCheckIn(
    mobileNumber: string,
    locationId: number,
  ): Promise<void> {
    GDExpectedException.try(
      LocationExceptions.mobileNumberRequired,
      mobileNumber,
    );

    const latestCheckin = await this.mobileCheckInService.getLatestCheckIn(
      mobileNumber,
    );
    GDExpectedException.try(
      LocationExceptions.checkinRestricted,
      latestCheckin,
    );

    const location = await this.findById(locationId);
    GDExpectedException.try(LocationExceptions.locationNotFound, location);
  }

  public async getLocationPosInfo(locationId: number): Promise<PosInfo> {
    return this.locationRepository
      .createQueryBuilder('location')
      .select([
        'location.id as "locationId"',
        'location.pos_id as "locationPosId"',
        'organization.pos_id as "organizationPosId"',
        'organization.pos_config as "posConfig"',
        'organization.pos as "pos"',
      ])
      .innerJoin('location.organization', 'organization')
      .where('location.id = :locationId', { locationId })
      .getRawOne();
  }

  public async getLocationDeliveryTimeSlots(
    locationId: number,
  ): Promise<DeliveryTime> {
    let slots: any = null;
    try {
      const query = this.deliveryTimeRepository
        .createQueryBuilder('delivery_time')
        .where('delivery_time.store_id = ' + locationId)
        .orderBy('delivery_time.day_num', 'ASC');
      slots = await query.getManyAndCount();
    } catch (error) {
      throw error;
    }
    return new Promise<DeliveryTime>(resolve => {
      resolve(slots);
    });
  }

  public async updateOffHoursByOrganizationId(
    organizationId: number,
    allowOffHours: boolean,
  ): Promise<Location[]> {
    try {
      const [locations = []] = await this.findWithFilter({
        organizationId,
      });
      const locationPromises = locations.map(({ id }) =>
        this.locationRepository.save({ id, allowOffHours }),
      );

      return Promise.all(locationPromises);
    } catch (error) {
      throw error;
    }
  }

  public async findWithActiveDealsCount(
    searchParams: SearchParams = {},
  ): Promise<[LocationActiveDealsDto[], number]> {
    searchParams = defaults(searchParams, DEFAULT_PARAMS);
    const { search, page, limit, order, dealId, assignedUserId } = searchParams;

    const offset = page * limit;
    const query = this.locationRepository
      .createQueryBuilder('location')
      .select([
        `location.id as id`,
        `location.name as name`,
        `organization.id as "orgId"`,
        `organization.name as "orgName"`,
        `organization.maxActiveDeals as "orgMaxActiveDeals"`,
        'COUNT("activeDeals"."dealId")::INTEGER as "orgActiveDealsCount"',
      ])
      .innerJoin('location.organization', 'organization')
      .leftJoin(
        subQuery =>
          subQuery
            .select([
              'location.organization_id as "orgId"',
              'deal.id as "dealId"',
            ])
            .from(Location, 'location')
            .innerJoin(
              'location.deals',
              'locationDeal',
              'locationDeal.deleted = false',
            )
            .innerJoin('locationDeal.deal', 'deal', 'deal.deleted = false')
            .andWhere(
              `CASE
                WHEN deal.endDate IS NOT NULL
                THEN timezone(deal.timezone, current_timestamp) ::DATE <= deal.endDate ::DATE
                ELSE true
              END`,
            )
            .andWhere('location.deleted = false')
            .groupBy('location.organization, deal.id'),
        'activeDeals',
        'organization.id = "activeDeals"."orgId"',
      )
      .andWhere('location.deleted = false')
      .groupBy('location.id, organization.id,  "activeDeals"."orgId"')
      .limit(limit)
      .offset(offset);

    if (search) {
      const filter = '%' + search + '%';
      query.andWhere(`location.name ILIKE :filter`, {
        filter,
      });
    }
    if (dealId) {
      query
        .innerJoin('location.deals', 'deals', 'deals.deleted = false')
        .andWhere('deals.deal = :dealId', { dealId });
    }
    if (assignedUserId) {
      query.andWhere(queryBuilder => {
        const subQuery = queryBuilder
          .subQuery()
          .select(['userLocation.location_id'])
          .from(UserLocation, 'userLocation')
          .where(
            'userLocation.user_id = :assignedUserId AND userLocation.deleted = false',
            { assignedUserId },
          )
          .getQuery();
        return 'location.id IN ' + subQuery;
      });
    }
    if (order) {
      const [column, value = 'ASC'] = order.split(' ');
      const orderValue = value.toUpperCase() as 'ASC' | 'DESC';

      if (column === 'orgActiveDealsCount') {
        query.orderBy(`"orgActiveDealsCount"`, orderValue);
      } else {
        query.orderBy(`location.${column}`, orderValue);
      }
    } else {
      query.orderBy('location.id', 'ASC');
    }

    const rawMany = await query.getRawMany();
    const count = await query.getCount();
    return [rawMany, count];
  }

  public async getReachedDealsLimit(
    dealId?: number,
    locationIds?: number[],
  ): Promise<Location[]> {
    const tableName = 'location';
    const query = this.locationRepository
      .createQueryBuilder(tableName)
      .select(['location.id', 'organization.id'])
      .innerJoin('location.organization', 'organization')
      .leftJoin(
        'location.deals',
        'locationDeal',
        'locationDeal.deleted = false',
      )
      .leftJoin('locationDeal.deal', 'deal')
      .andWhere('location.deleted = false');

    const reachedDealsLimitClause = `
      CASE
        WHEN organization.max_active_deals IS NULL THEN false
        ELSE COUNT("activeDeal"."organizationId") >= organization.max_active_deals
      END`;
    const activeDealQuery = subquery =>
      subquery
        .select(['location.organization_id as "organizationId"'])
        .from(Location, 'location')
        .innerJoin(
          'location.deals',
          'locationDeal',
          'locationDeal.deleted = false',
        )
        .innerJoin('locationDeal.deal', 'deal', 'deal.deleted = false')
        .andWhere(
          `CASE
            WHEN deal.endDate IS NOT NULL
            THEN timezone(deal.timezone, current_timestamp) ::DATE <= deal.endDate ::DATE
            ELSE true
          END`,
        )
        .andWhere('location.deleted = false')
        .groupBy('location.organization_id, deal.id');
    const reachedDealsLimitQuery = subquery =>
      subquery
        .select([
          'organization.id as "organizationId"',
          `${reachedDealsLimitClause} as "reachedLimit"`,
        ])
        .from(Organization, 'organization')
        .leftJoin(
          activeDealQuery,
          'activeDeal',
          'organization.id = "activeDeal"."organizationId"',
        )
        .groupBy('organization.id');
    query
      .innerJoin(
        reachedDealsLimitQuery,
        'reachedDealsLimit',
        'organization.id = "reachedDealsLimit"."organizationId"',
      )
      .andWhere('"reachedDealsLimit"."reachedLimit" = true')
      .groupBy('organization.id, location.id');

    if (dealId) {
      query.andWhere('deal.id = :dealId', { dealId });
    }
    if (!isEmpty(locationIds)) {
      query.andWhere('location.id IN (:...locationIds)', {
        locationIds,
      });
    }

    return query.getMany();
  }
  public async getSearchCount(
    searchParams: SearchParams,
  ): Promise<SearchCountMapping> {
    const { search } = searchParams;
    if (!search) {
      return { count: 0 };
    }
    const [, count] = await this.findWithFilter({
      search,
    });
    return { count };
  }
}
