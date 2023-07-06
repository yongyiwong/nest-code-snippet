import { get } from 'bdd-lazy-var';
import * as log from 'fancy-log';
import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseInterceptors,
  UsePipes,
  Req,
  Res,
  Next,
  BadRequestException,
  HttpService,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiImplicitQuery,
  ApiResponse,
  ApiUseTags,
  ApiOperation,
  ApiImplicitBody,
  ApiImplicitParam,
} from '@nestjs/swagger';
import { OwnerInterceptor, Roles } from '@sierralabs/nest-identity';
import {
  ParseBooleanPipe,
  ParseEntityPipe,
  RequiredPipe,
} from '@sierralabs/nest-utils';
import { UpdateResult } from 'typeorm';
import { find } from 'lodash';

import { SearchValidationPipe } from '../common/pipes/search-validation.pipe';
import { CouponService } from '../coupon/coupon.service';
import { LocationInventoryStatsDto } from './dto/location-inventory-stats.dto';
import { LocationOrderStatsDto } from './dto/location-order-stats.dto';
import { LocationPhotoPresignDto } from './dto/location-photo-presign.dto';
import {
  LocationSearchDto,
  LocationActiveDealsDto,
} from './dto/location-search.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Coupon } from '../entities/coupon.entity';
import { Location } from '../entities/location.entity';
import { LocationHour } from '../entities/location-hour.entity';
import { LocationDeliveryHour } from '../entities/location-delivery-hour.entity';
import { LocationRating } from '../entities/location-rating.entity';
import { MobileCheckIn } from '../entities/mobile-check-in.entity';
import { Product } from '../entities/product.entity';
import { User } from '../entities/user.entity';
import { GDExpectedException } from '../gd-expected.exception';
import { HoursService } from './hours/hours.service';
import { LocationService } from './location.service';
import { LocationExceptions } from './location.exceptions';
import { MobileCheckInDto } from '../mobile-check-in/mobile-check-in.dto';
import { MobileCheckInService } from '../mobile-check-in/mobile-check-in.service';
import { NotificationService } from '../notification/notification.service';

import { OrganizationService } from '../organization/organization.service';
import { ProductDto } from '../product/dto/product.dto';
import { ProductService } from '../product/product.service';
import { RoleEnum } from '../roles/roles.enum';
import { UserService } from './../user/user.service';
import { UserLocationService } from '../user-location/user-location.service';
import { UserExceptions } from '../user/user.exceptions';
import { OrganizationExceptions } from '../organization/organization.exceptions';
import { UserLocationExceptions } from '../user-location/user-location.exceptions';
import { SearchParams } from '../common/search-params.interface';
import { OrderService } from '../order/order.service';
import { OrderExceptions } from '../order/order.exceptions';
import { DeliveryTime } from '../entities/delivery-time.entity';
import { getConnection } from 'typeorm';

import {
  MjfreewayOrderService,
  PosInfo,
} from '../synchronize/mjfreeway/mjfreeway-order.service';

const { Admin, SiteAdmin, Employee } = RoleEnum;
@ApiBearerAuth()
@ApiUseTags('Locations')
@Controller('locations')
export class LocationController {
  constructor(
    private readonly locationService: LocationService,
    private readonly productService: ProductService,
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly couponService: CouponService,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
    private readonly userLocationService: UserLocationService,
    private readonly hoursService: HoursService,
    private readonly mobileCheckInService: MobileCheckInService,
    private readonly organizationService: OrganizationService,
    @Inject(forwardRef(() => MjfreewayOrderService))
    private readonly mjfreewayOrderService: MjfreewayOrderService,
    private readonly httpService: HttpService,
  ) {}

  @Get()
  @ApiResponse({
    status: LocationExceptions.invalidStartingLatLong.httpStatus,
    description: LocationExceptions.invalidStartingLatLong.message,
  })
  @UsePipes(new SearchValidationPipe(Location))
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'minLat', required: false })
  @ApiImplicitQuery({ name: 'minLong', required: false })
  @ApiImplicitQuery({ name: 'maxLat', required: false })
  @ApiImplicitQuery({ name: 'maxLong', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  @ApiImplicitQuery({ name: 'organizationId', required: false })
  @ApiImplicitQuery({ name: 'startFromLat', required: false })
  @ApiImplicitQuery({ name: 'startFromLong', required: false })
  @ApiImplicitQuery({ name: 'assignedUserId', required: false })
  @ApiImplicitQuery({ name: 'couponId', required: false })
  @ApiImplicitQuery({ name: 'includeDeleted', required: false })
  @ApiImplicitQuery({ name: 'deliveryAvailableOnly', required: false })
  public async search(
    @Query('search') search?: string,
    @Query('minLat') minLat?: number,
    @Query('minLong') minLong?: number,
    @Query('maxLat') maxLat?: number,
    @Query('maxLong') maxLong?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
    @Query('organizationId') organizationId?: number,
    @Query('startFromLat') startFromLat?: number,
    @Query('startFromLong') startFromLong?: number,
    @Query('assignedUserId') assignedUserId?: number,
    @Query('couponId') couponId?: number,
    @Query('includeDeleted', new ParseBooleanPipe()) includeDeleted?: boolean,
    @Query('deliveryAvailableOnly', new ParseBooleanPipe())
    deliveryAvailableOnly?: boolean,
  ): Promise<[LocationSearchDto[], number]> {
    return this.locationService.findWithFilter({
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
    });
  }

  @Get(':id([0-9]+)')
  @ApiImplicitQuery({ name: 'includeDeleted', required: false })
  public async getOne(
    @Param('id', new ParseIntPipe()) id: number,
    @Query('includeDeleted', new ParseBooleanPipe()) includeDeleted?: boolean,
  ): Promise<LocationSearchDto> {
    try {
      const location = await this.locationService.findById(id, includeDeleted);
      GDExpectedException.try(LocationExceptions.locationNotFound, location);
      return Promise.resolve(location);
    } catch (error) {
      throw error;
    }
  }

  @Get('getallproducts')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  @ApiImplicitQuery({ name: 'includeAllStock', required: false })
  @ApiImplicitQuery({ name: 'includeDeleted', required: false })
  @ApiImplicitQuery({ name: 'includeHidden', required: false })
  @ApiImplicitQuery({ name: 'category', required: false })
  public async getallproducts(
    // @Param('id', new ParseIntPipe()) locationId: number,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
    @Query('paginated', new ParseBooleanPipe()) paginated?: boolean,
    @Query('includeAllStock', new ParseBooleanPipe()) includeAllStock?: boolean,
    @Query('includeDeleted', new ParseBooleanPipe()) includeDeleted?: boolean,
    @Query('includeHidden', new ParseBooleanPipe()) includeHidden?: boolean,
    @Query('category') category?: string,
  ): Promise<[ProductDto[], number]> {
    return this.productService.getAllProducts({
      // locationId,
      search,
      page,
      limit,
      paginated,
      order,
      includeAllStock,
      includeDeleted,
      includeHidden,
      category,
    });
  }

  @Get(':id([0-9]+)/products')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  @ApiImplicitQuery({ name: 'includeAllStock', required: false })
  @ApiImplicitQuery({ name: 'includeDeleted', required: false })
  @ApiImplicitQuery({ name: 'includeHidden', required: false })
  @ApiImplicitQuery({ name: 'category', required: false })
  public async getProducts(
    @Param('id', new ParseIntPipe()) locationId: number,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
    @Query('includeAllStock', new ParseBooleanPipe()) includeAllStock?: boolean,
    @Query('includeDeleted', new ParseBooleanPipe()) includeDeleted?: boolean,
    @Query('includeHidden', new ParseBooleanPipe()) includeHidden?: boolean,
    @Query('category') category?: string,
  ): Promise<[ProductDto[], number]> {
    return this.productService.findWithFilter({
      locationId,
      search,
      page,
      limit,
      order,
      includeAllStock,
      includeDeleted,
      includeHidden,
      category,
    });
  }

  @Roles(Admin, SiteAdmin)
  @Post()
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async create(
    @Body(new RequiredPipe()) location: Location,
  ): Promise<Location> {
    try {
      const ENABLE_AUTO_ASSIGN = true;
      return this.locationService.create(location, ENABLE_AUTO_ASSIGN);
    } catch (error) {
      throw error;
    }
  }

  @Roles(Admin, SiteAdmin)
  @Put(':id([0-9]+)')
  @UseInterceptors(new OwnerInterceptor(['modifiedBy']))
  public async update(
    @Param('id', new ParseIntPipe()) id: number,
    @Body(
      new RequiredPipe(),
      new ParseEntityPipe({ validate: { skipMissingProperties: true } }),
    )
    location: Location,
  ): Promise<LocationSearchDto> {
    const INCLUDE_DELETED = true;
    if (location.allowOffHours) {
      const { organization } = await this.locationService.findById(
        id,
        INCLUDE_DELETED,
      );
      GDExpectedException.try(
        OrganizationExceptions.organizationOffHoursDisabled,
        { location, organization },
      );
    }
    location = await this.locationService.update(location);
    return this.locationService.findById(location.id, INCLUDE_DELETED); // return complete record
  }

  @Roles(Admin, SiteAdmin)
  @Delete(':id([0-9]+)')
  public async remove(
    @Param('id') id: number,
    @Req() request,
  ): Promise<UpdateResult> {
    return this.locationService.remove(id, request.user.id);
  }

  @Get(':id([0-9]+)/products/:productId([0-9]+)')
  @ApiImplicitQuery({ name: 'includeHidden', required: false })
  @ApiImplicitQuery({ name: 'includeDeletedWeightPrices', required: false })
  public async getProductDetail(
    @Param('id', new ParseIntPipe()) locationId: number,
    @Param('productId', new ParseIntPipe()) productId: number,
    @Query('includeHidden', new ParseBooleanPipe()) includeHidden?: boolean,
    @Query('includeDeletedWeightPrices', new ParseBooleanPipe())
    includeDeletedWeightPrices?: boolean,
  ): Promise<Product> {
    try {
      const product = await this.productService.findById(
        productId,
        locationId,
        null,
        null,
        includeHidden,
        includeDeletedWeightPrices,
      );

      GDExpectedException.try(OrderExceptions.productNotFound, product);
      return Promise.resolve(product);
    } catch (error) {
      throw error;
    }
  }

  @Roles(Admin, SiteAdmin)
  @Post(':id([0-9]+)/products')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async createProduct(
    @Param('id', new ParseIntPipe()) id: number,
    @Body(new RequiredPipe()) product: Product,
    @Req() request,
  ): Promise<Product> {
    product.location = new Location();
    product.location.id = id;

    if (find(request.user.roles, { name: SiteAdmin })) {
      const userAssignedLocations = await this.userLocationService.getAllByUserId(
        request.user.id,
      );
      GDExpectedException.try(UserLocationExceptions.notAssignedToLocation, {
        user: request.user,
        currentLocationId: id,
        userAssignedLocations,
      });
    }
    return this.productService.create(product);
  }

  @Roles(Admin, SiteAdmin)
  @Put(':id([0-9]+)/products/:productId([0-9]+)')
  @UseInterceptors(new OwnerInterceptor(['modifiedBy']))
  public async updateProduct(
    @Param('id', new ParseIntPipe()) id: number,
    @Param('productId', new ParseIntPipe()) productId: number,
    @Body(
      new RequiredPipe(),
      new ParseEntityPipe({ validate: { skipMissingProperties: true } }),
    )
    product: UpdateProductDto,
    @Req() request,
  ): Promise<Product> {
    product.id = productId;
    product.location = new Location();
    product.location.id = id;
    const updatedProduct = {
      ...new Product(),
      ...product,
    };

    if (find(request.user.roles, { name: SiteAdmin })) {
      const userAssignedLocations = await this.userLocationService.getAllByUserId(
        request.user.id,
      );
      GDExpectedException.try(UserLocationExceptions.notAssignedToLocation, {
        user: request.user,
        currentLocationId: id,
        userAssignedLocations,
      });
    }

    await this.productService.update(updatedProduct);
    return this.productService.findById(productId, null, null, null, true); // return complete record
  }

  @Roles(Admin, SiteAdmin)
  @Delete(':id([0-9]+)/products/:productId([0-9]+)')
  public async removeProduct(
    @Param('id', new ParseIntPipe()) id: number,
    @Param('productId', new ParseIntPipe()) productId: number,
    @Req() request,
  ): Promise<UpdateResult> {
    return this.productService.remove(productId, request.user.id);
  }

  @Get(':id([0-9]+)/coupons')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  public async getCoupons(
    @Param('id', new ParseIntPipe()) id: number,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
  ): Promise<[Coupon[], number]> {
    return this.couponService.getCoupons(
      search,
      page,
      limit,
      order,
      id,
      false,
      false,
    );
  }

  @Roles('$authenticated')
  @Post(':id([0-9]+)/reviews')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  @ApiImplicitQuery({ name: 'disableInterval', required: false })
  public async createReview(
    @Param('id', new ParseIntPipe()) id: number,
    @Body(new RequiredPipe()) review: LocationRating,
    @Req() request,
    @Query('disableInterval', new ParseBooleanPipe()) disableInterval?: boolean,
  ): Promise<LocationRating> {
    review.user = new User();
    review.user.id = request.user.id;
    review.location = new Location();
    review.location.id = id;

    try {
      if (disableInterval) {
        const user = (await this.userService.findById(request.user.id)) || {
          roles: [],
        };
        GDExpectedException.try(UserExceptions.noAdminRights, {
          userRoles: user.roles,
          allowedRoles: [Admin, SiteAdmin],
        });
      }
      return this.locationService.createReview(review, disableInterval);
    } catch (error) {
      throw error;
    }
  }

  @Roles(Admin, SiteAdmin)
  @Put(':id([0-9]+)/reviews/:reviewId')
  @UseInterceptors(new OwnerInterceptor(['modifiedBy']))
  public async updateReview(
    @Param('id', new ParseIntPipe()) id: number,
    @Param('reviewId', new ParseIntPipe()) reviewId: number,
    @Body(
      new RequiredPipe(),
      new ParseEntityPipe({ validate: { skipMissingProperties: true } }),
    )
    review: LocationRating,
    @Req() request,
  ): Promise<LocationRating> {
    const assignedLocation = new Location();
    assignedLocation.id = id;
    const updatedReview = {
      ...review,
      id: reviewId,
      location: assignedLocation,
    };
    return this.locationService.updateReview(updatedReview);
  }

  @Roles(Admin, SiteAdmin, Employee)
  @Get(':id([0-9]+)/reviews/:reviewId')
  public async getReview(
    @Param('id') id: number,
    @Param('reviewId', new ParseIntPipe()) reviewId: number,
  ): Promise<LocationRating> {
    return this.locationService.getReview(id, reviewId);
  }

  @Get(':id([0-9]+)/reviews')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  @ApiImplicitQuery({ name: 'includeDeleted', required: false })
  @UsePipes(new SearchValidationPipe(LocationRating))
  public async getReviews(
    @Param('id', new ParseIntPipe()) id: number,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
    @Query('includeDeleted', new ParseBooleanPipe()) includeDeleted?: boolean,
  ): Promise<[LocationRating[], number]> {
    return this.locationService.getReviews(
      id,
      search,
      page,
      limit,
      order,
      includeDeleted,
    );
  }

  @Roles(Admin, SiteAdmin, Employee)
  @Get(':id([0-9]+)/patients')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  public async getPatients(
    @Param('id', new ParseIntPipe()) locationId: number,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
  ): Promise<[User[], number]> {
    return this.orderService.getPatients(
      locationId,
      null,
      search,
      page,
      limit,
      order,
    );
  }

  @Roles(Admin, SiteAdmin, Employee)
  @Get(':id([0-9]+)/hours')
  public async getLocationHours(
    @Param('id') id: number,
  ): Promise<LocationHour[]> {
    return this.hoursService.getLocationHours(id);
  }

  @Roles(Admin, SiteAdmin)
  @Post(':id([0-9]+)/hours')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async saveLocationHours(
    @Param('id') id: number,
    @Body(new RequiredPipe()) locationHours: LocationHour[],
  ): Promise<LocationHour[]> {
    locationHours.forEach(hour => {
      hour.location = new Location();
      hour.location.id = id;
    });
    return this.hoursService.saveLocationHours(locationHours);
  }

  @Roles(Admin, SiteAdmin)
  @Post(':id([0-9]+)/setdelivery-hours')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async saveLocationDeliveryHours(
    @Param('id') id: number,
    @Body(new RequiredPipe()) deliveryHours: LocationDeliveryHour[],
  ): Promise<LocationHour[]> {
    deliveryHours.forEach(hour => {
      hour.location = new Location();
      hour.location.id = id;
    });
    return this.hoursService.saveLocationDeliveryHours(deliveryHours);
  }

  @Get('delivery_Timings/:id([0-9]+)')
  public async getDispensaryDeliveryTimings(
    @Param('id') id: number,
  ): Promise<DeliveryTime> {
    return this.locationService.getDeliveryTimeByLocation(id);
  }

  @Roles(Admin, SiteAdmin)
  @Post('delivery-hours_data')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async saveDeliveryHourstimeSlots(
    @Req() request,
    // @Param('id') id: number,
    // @Body(new RequiredPipe()) deliveryHours: LocationDeliveryHour[],
  ): Promise<UpdateResult> {
    // deliveryHours.forEach(hour => {
    //   hour.location = new Location();
    //   hour.location.id = id;
    // });
    const day = request.body.day;
    const dayNum = request.body.dayNum;
    const maxOrdersHour = request.body.maxOrderNumber;

    // const time = request.body.time;

    const checkboxselectedArrayIds: [] = request.body.ids;
    const checkboxselectedTimeslots: [] = request.body.time;

    const selectedcheckbox = checkboxselectedArrayIds.map(async x => {
      const locationId = x;
      // return this.hoursService.saveLocationDeliveryTimeslots(deliveryHours);
      checkboxselectedTimeslots.map(async y => {
        const timeSlot = y;

        try {
          const result = await this.locationService.getDeliveryTimeByLocationDay(
            locationId,
            day,
            timeSlot,
          );
          if (result[1] === 0) {
            return this.locationService.saveLocationDeliveryTimeslots(
              day,
              timeSlot,
              locationId,
              maxOrdersHour,
              dayNum,
            );
          } else {
            return this.locationService.updateLocationDeliveryTimeslots(
              day,
              timeSlot,
              locationId,
              maxOrdersHour,
            );
          }
          // return  this.locationService.saveLocationDeliveryTimeslots(day, time, locationId );
        } catch (error) {
          throw error;
        }
      });
    });

    return;
  }

  @Post('get_max_order_by_id_day_timeslot')
  public async getDispensaryDeliveryTimingsDataByDayLocationTimeslots(
    @Req() request,
  ): Promise<DeliveryTime> {
    const locationId = request.body.locationID;
    const day = request.body.day;
    const timeSlot = request.body.time_slot;

    return this.locationService.getDeliveryTimeByLocationDay(
      locationId,
      day,
      timeSlot,
    );
  }

  @Post('send_order_delivery_sms')
  public async sendOrderDeliverySMS(@Req() request): Promise<string> {
    const mobileNumber = request.body.mobileNumber;
    const message = request.body.message;

    return this.locationService.sendOrderDeliverySMS(mobileNumber, message);
  }

  @Post('get_pos_config_status')
  public async getPosConfigStatus(@Req() request): Promise<object> {
    const orderId = request.body.orderId;
    const posInfo = await this.orderService.getPosInfo(orderId);
    const posOrderId = JSON.parse(JSON.stringify(posInfo)).orderPosId;
    const headers = await this.mjfreewayOrderService.getHttpConfig(posInfo);
    const data = await this.mjfreewayOrderService.getRemoteOrder(
      await posInfo,
      posOrderId,
    );
    return { posInfo, header_config: headers, data };
  }

  @Post('save_hotspot_locations')
  public async saveHotspotLocations(@Req() request): Promise<object> {
    const latLng = request.body.locations;
    await getConnection()
      .createQueryBuilder()
      .update('site_settings')
      .set({ value: latLng })
      .where('key = "locations"')
      .execute();

    // const status = await this.orderService.saveLocations(latLng);
    // await this.siteSettingsRepository
    //     .createQueryBuilder()
    //     .update(SiteSettings)
    //     .set({ value: latLng, modifiedBy: 1 })
    //     .where("key = 'locations'")
    //     .execute();
    return { status: 'success' };
  }

  @Post('get_hotspot_locations')
  public async getHotspotLocations(@Req() request): Promise<object> {
    const latLng = request.body.locations;

    const locations = await getConnection()
      .createQueryBuilder()
      .select('*')
      .from('site_settings', 'site_settings')
      .where('key = "locations"')
      .execute();

    return { locations };
  }

  @Post('get_pos_config_update')
  public async getPosConfigUpdate(@Req() request): Promise<object> {
    const orderId = request.body.orderId;
    const posInfo = await this.orderService.getPosInfo(orderId);
    const headers = await this.mjfreewayOrderService.getHttpConfig(posInfo);
    const updateStatus = await this.mjfreewayOrderService.syncSubmittedOrdersCustom(
      1,
      orderId,
    );
    return { posInfo, header_config: headers, updateStatus };
  }

  @Post('get_pos_config_update_user')
  public async getPosConfigUpdateUser(@Req() request): Promise<object> {
    const userId = request.body.userId;
    const updateStatus = await this.mjfreewayOrderService.syncSubmittedOrdersCustomUser(
      1,
      userId,
    );
    return { updateStatus };
  }

  @Post('get_pos_config_update_bulk')
  public async getPosConfigUpdateBulk(@Req() request): Promise<object> {
    const sDate = request.body.sDate;
    const updateStatus = await this.mjfreewayOrderService.syncSubmittedOrdersCustomBulk(
      1,
      sDate,
    );
    return { updateStatus };
  }

  @Post('get_location_delivery_time_slots')
  public async getLocationDeliveryTimeSlots(@Req() request): Promise<object> {
    const locationId = request.body.location_id;
    const slots = await this.locationService.getLocationDeliveryTimeSlots(
      locationId,
    );
    return { slots };
  }

  @Post('get_timeslots_by_day_location')
  public async getTimeslotsByDayLocation(
    @Req() request,
  ): Promise<DeliveryTime> {
    const locationId = request.body.locationID;
    const day = request.body.day;
    return this.locationService.getTimeslotsByDayLocation(locationId, day);
  }

  @Post('delivery-van-hours_data_by_driver')
  public async getDeliveryVanOrdersByDriver(@Req() request) {
    const driverId = request.body.DriverId;
    const date = request.body.date;

    const locationId = request.body.data.locationID;
    const timeSlot = request.body.data.time_slot;

    return this.locationService.getDeliveryVanOrders(
      driverId,
      locationId,
      timeSlot,
      date,
    );
  }

  @Post('get_driver_delivery_orders')
  public async getDriverDeliveryOrders(@Req() request) {
    const driverId = request.body.DriverId;
    const date = request.body.date;

    const locationId = request.body.locationID;
    const timeSlot = request.body.time_slot;

    return this.locationService.getDriverDeliveryOrders(
      driverId,
      locationId,
      timeSlot,
      date,
    );
  }

  @Post('get_driver_delivery_orders_all_driver')
  public async getDriverDeliveryOrdersAllDriver(@Req() request) {
    const driverId = request.body.DriverId;
    const date = request.body.date;

    return this.locationService.getDriverDeliveryOrdersByDriver(driverId, date);
  }

  @Put('put_driver_delivery_orders')
  public async putDriverDeliveryOrders(@Req() request) {
    const driverId = request.body.DriverId;
    const date = request.body.date;

    const locationId = request.body.locationID;
    const timeSlot = request.body.time_slot;
    const orderId = request.body.order_id;
    return this.locationService.saveDriverDeliveryOrders(
      driverId,
      locationId,
      timeSlot,
      date,
      orderId,
    );
  }

  @Post('get_driver_id')
  public async getDriverId(@Req() request) {
    const locationId = request.body.locationID;

    return this.locationService.getDriverId(locationId);
  }

  @Roles(Admin, SiteAdmin)
  @Post('delivery-van-hours_data')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async saveDeliveryHourstimeSlotsForVan(
    @Req() request,
  ) {
    const driverId = request.body.DriverId;
    const date = request.body.date;
    const checkboxSelectedArraydata: [] = request.body.data;

    checkboxSelectedArraydata.map(async x => {
      const data: any = x;
      const timeSlot = data.time_slot;
      const maxOrdersHour = data.max_order;
      const counter = data.count;
      const locationId = data.locationID;

      try {
        const result = await this.locationService.getDeliveryVanOrders(
          driverId,
          locationId,
          timeSlot,
          date,
        );
        const resultCount = await this.locationService.getDeliveryVanOrdersCount(
          driverId,
          locationId,
          timeSlot,
          date,
        );

        if (resultCount < 1) {
          const returnVal = await this.locationService.saveDeliveryVanTimeslots(
            driverId,
            date,
            timeSlot,
            maxOrdersHour,
            counter,
            locationId,
          );
          return returnVal;
        } else {
          const updatedcounter = result[0][0].counter + 1;
          if (result[0][0].counter < result[0][0].maxOrdersPerHour) {
            return await this.locationService.updateDeliveryVanTimeslots(
              driverId,
              date,
              timeSlot,
              updatedcounter,
              locationId,
            );
          } else {
            throw new BadRequestException('Max order is reached for driver');
          }
        }
      } catch (error) {
        throw error;
      }
    });

    return;
  }

  @Roles(Admin, SiteAdmin, Employee)
  @Get(':id([0-9]+)/orders/stats')
  public async getOrderStats(
    @Param('id') id: number,
  ): Promise<LocationOrderStatsDto> {
    return this.orderService.getOrderStats(id);
  }

  @Roles(Admin, SiteAdmin, Employee)
  @Get(':id([0-9]+)/inventory/stats')
  public async getInventoryStats(
    @Param('id') id: number,
  ): Promise<LocationInventoryStatsDto> {
    return this.productService.getInventoryStats(id);
  }

  @Roles('$authenticated')
  @Post(':id([0-9]+)/reviews/:reviewId([0-9]+)/report')
  @UseInterceptors(new OwnerInterceptor(['createdBy', 'modifiedBy']))
  public async reportReview(
    @Param('id', new ParseIntPipe()) locationId: number,
    @Param('reviewId', new ParseIntPipe()) reviewId: number,
    @Req() request,
  ): Promise<boolean> {
    const reportedBy = (await this.userService.findById(
      request.user.id,
    )) as User;
    const review = await this.locationService.getReview(locationId, reviewId);

    const sendTo = await this.userService.getUsersReportReviewNotif(locationId);
    Promise.all(
      sendTo.map(async user => {
        const emailNotification = this.locationService.composeReportReviewEmail(
          review,
          user,
          reportedBy,
          user.locale,
        );
        this.notificationService
          .sendEmailMessage(emailNotification, user.locale)
          .then(data => {
            // do nothing
          })
          .catch(error => {
            // send failure
            log.error(error.stack);
          });
      }),
    );
    return true;
  }

  @Roles(Admin, SiteAdmin)
  @ApiOperation({ title: 'Create Presigned Url for S3' })
  @Post('photo/presign')
  public async createPresignedPost(
    @Body(new RequiredPipe()) locationPhotoPresignDto: LocationPhotoPresignDto,
  ): Promise<any> {
    return this.locationService.createPresignedPost(locationPhotoPresignDto);
  }

  @ApiOperation({ title: 'Proxy location photo from S3' })
  @Get('photo/file/:fileKey')
  public proxyFile(
    @Param('fileKey') fileKey: string,
    @Req() request,
    @Res() response,
    @Next() next,
  ): any {
    this.locationService.proxyFile(fileKey, request, response, next);
  }

  @Roles(Admin, SiteAdmin, Employee)
  @Get(':id([0-9]+)/users')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  public async getAssignedUsers(
    @Param('id', new ParseIntPipe()) locationId: number,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
  ): Promise<[User[], number]> {
    locationId = +locationId;
    return this.userLocationService.getAllUsers(
      locationId,
      search,
      page,
      limit,
      order,
    );
  }

  @Get('nearest')
  @ApiImplicitQuery({ name: 'organizationPosId', required: false })
  @ApiImplicitQuery({ name: 'startFromLat', required: true })
  @ApiImplicitQuery({ name: 'startFromLong', required: true })
  public async getNearestLocation(
    @Query('startFromLat') startFromLat: number,
    @Query('startFromLong') startFromLong: number,
    @Query('organizationPosId') organizationPosId?: number,
  ): Promise<LocationSearchDto> {
    try {
      return this.locationService.getNearestLocation(
        organizationPosId,
        startFromLat,
        startFromLong,
      );
    } catch (error) {
      throw error;
    }
  }

  @Post('mobile-check-in')
  public async addMobileCheckIn(
    @Body(new RequiredPipe()) mobileCheckInDto: MobileCheckInDto,
  ): Promise<MobileCheckIn> {
    try {
      return this.locationService.checkIn(mobileCheckInDto);
    } catch (error) {
      throw error;
    }
  }

  @Get('mobile-check-in/:mobileCheckInId([0-9]+)')
  public async findMobileCheckInsById(
    @Param('mobileCheckInId', new ParseIntPipe()) mobileCheckInId: number,
  ): Promise<MobileCheckIn> {
    try {
      return this.mobileCheckInService.findById(mobileCheckInId);
    } catch (error) {
      throw error;
    }
  }

  @Roles('$authenticated')
  @Post('mobile-check-in/rewards')
  @ApiImplicitBody({
    name: 'body',
    required: true,
    type: class {
      mobileNumber: string;
      isFirstTime: boolean;
      new() {}
    },
  })
  public async claimRewards(
    @Body('mobileNumber') mobileNumber: string,
    @Body('isFirstTime', new ParseBooleanPipe()) isFirstTime: boolean = false,
    @Req() request,
  ): Promise<boolean> {
    // isFirstTime will be toggled only by the sign-up page's autologin.
    try {
      const isClaimed = await this.mobileCheckInService.claimReward(
        request.user,
        mobileNumber,
        isFirstTime,
      );
      return !!isClaimed;
    } catch (error) {
      throw error;
    }
  }

  @Roles(Admin, SiteAdmin)
  @Get('active-deals-count')
  @ApiImplicitQuery({ name: 'search', required: false })
  @ApiImplicitQuery({ name: 'page', required: false })
  @ApiImplicitQuery({ name: 'limit', required: false })
  @ApiImplicitQuery({ name: 'order', required: false })
  @ApiImplicitQuery({ name: 'assignedUserId', required: false })
  async findWithActiveDealsCount(
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('order') order?: string,
    @Query('assignedUserId') assignedUserId?: number,
  ): Promise<[LocationActiveDealsDto[], number]> {
    const searchParams: SearchParams = {
      search,
      page,
      limit,
      order,
      assignedUserId,
    };
    return this.locationService.findWithActiveDealsCount(searchParams);
  }
}
